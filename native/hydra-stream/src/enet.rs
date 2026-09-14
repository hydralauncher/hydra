//! Minimal ENet protocol server (protocol version 1, compatible with the
//! ENet client embedded in moonlight-common-c). Hand-rolled from the ENet
//! protocol documentation and reference implementation (MIT-licensed),
//! reduced to what the GameStream control channel needs:
//!
//! - CONNECT / VERIFY_CONNECT handshake
//! - ACKNOWLEDGE of every reliable command
//! - reliable sequenced delivery per channel (with reordering)
//! - PING / DISCONNECT / BANDWIDTH_LIMIT / THROTTLE_CONFIGURE handling
//! - retransmission of unacknowledged server commands
//!
//! Datagrams that do not parse as ENet protocol traffic (e.g. stray raw
//! input packets) are reported to the caller as `NonProtocol` so they can
//! be tolerated without disturbing the protocol state.

use std::collections::BTreeMap;
use std::net::SocketAddr;
use std::time::{Duration, Instant};

pub const COMMAND_ACKNOWLEDGE: u8 = 1;
pub const COMMAND_CONNECT: u8 = 2;
pub const COMMAND_VERIFY_CONNECT: u8 = 3;
pub const COMMAND_DISCONNECT: u8 = 4;
pub const COMMAND_PING: u8 = 5;
pub const COMMAND_SEND_RELIABLE: u8 = 6;
pub const COMMAND_SEND_UNRELIABLE: u8 = 7;
pub const COMMAND_SEND_FRAGMENT: u8 = 8;
pub const COMMAND_SEND_UNSEQUENCED: u8 = 9;
pub const COMMAND_BANDWIDTH_LIMIT: u8 = 10;
pub const COMMAND_THROTTLE_CONFIGURE: u8 = 11;
pub const COMMAND_MASK: u8 = 0x0F;
pub const FLAG_ACKNOWLEDGE: u8 = 0x80;

pub const HEADER_FLAG_SENT_TIME: u16 = 0x8000;
pub const HEADER_SESSION_SHIFT: u16 = 12;
pub const HEADER_SESSION_MASK: u16 = 0x3000;
pub const MAXIMUM_PEER_ID: u16 = 0x0FFF;

pub const MINIMUM_MTU: u32 = 576;
pub const MAXIMUM_MTU: u32 = 4096;
pub const HOST_MTU: u32 = 1392;
pub const MINIMUM_WINDOW_SIZE: u32 = 4096;
pub const MAXIMUM_WINDOW_SIZE: u32 = 65536;
pub const MAXIMUM_CHANNEL_COUNT: usize = 255;

pub const THROTTLE_INTERVAL: u32 = 5000;
pub const THROTTLE_ACCELERATION: u32 = 2;
pub const THROTTLE_DECELERATION: u32 = 2;

pub const RETRANSMIT_TIMEOUT: Duration = Duration::from_millis(500);
pub const MAX_RETRANSMITS: u32 = 20;

// Receive-window sizing. The ENet reference (enet.h) buffers out-of-order
// reliables in [cursor, cursor + FREE - 1) windows anchored at the
// DELIVERY cursor and, crucially, suppresses the ACK for commands in its
// discard band (peer.c enet_peer_queue_acknowledgement) so the sender
// retransmits them once the cursor advances into range. We ACK on
// receipt (GameStream semantic: each ACK frees a slot in the client's
// send window), so a discarded-but-acked command would never come back
// and would wedge the channel. The accept range is therefore widened to
// a full half of the 16-bit sequence space; only sequences at/below the
// delivery cursor or absurdly far ahead of the accepted watermark are
// discarded, and the latter are NOT acked (reference semantics).
const RELIABLE_WINDOW_SIZE: u32 = 0x1000;
const FREE_RELIABLE_WINDOWS: u32 = 8;
/// Discard arrivals more than FREE - 1 windows (7 * 4096) ahead of the
/// accepted watermark: an honest peer's counter is sequential, so this
/// takes a ~28k-message loss run — the bound exists for garbage input,
/// not for flow control.
const MAX_AHEAD_OF_WATERMARK: u16 = ((FREE_RELIABLE_WINDOWS - 1) * RELIABLE_WINDOW_SIZE) as u16;
/// Accept anything up to FREE windows (half the u16 space) ahead of the
/// delivery cursor; beyond that "ahead" is indistinguishable from
/// "behind" in 16-bit sequence space.
const ACCEPT_RELIABLE_RANGE: u16 = (FREE_RELIABLE_WINDOWS * RELIABLE_WINDOW_SIZE) as u16;
/// Stalled-channel diagnostic thresholds (control.rs logs the warnings
/// on its 5s stats cadence).
const STALL_GAP_THRESHOLD: u16 = 256;
const STALL_WARN_AFTER: Duration = Duration::from_secs(5);
/// Discards traced per channel: the first this many name their sequence,
/// both cursors and which rule fired, then the channel goes quiet and only
/// the counters keep moving. A live session must show WHICH of the two
/// discard paths (behind the delivery cursor / far ahead of the watermark)
/// fires on legitimate input traffic — the 2026-09-14 freeze discarded
/// 27-95 reliables per 5s window while the user played and the adaptive
/// ladder read those discards as congestion — but a per-packet line on the
/// input path is not affordable, hence the cap.
const DISCARD_TRACE_LIMIT: u32 = 20;

/// Reassembly bounds for COMMAND_SEND_FRAGMENT. The protocol this follows
/// (cgutman/enet, the fork moonlight-common-c vendors) raised
/// `ENET_PROTOCOL_MAXIMUM_FRAGMENT_COUNT` to 1024 * 1024 and lets a
/// fragment header advertise its message's full totalLength, so ONE
/// 24-byte fragment can claim gigabytes of reassembly buffer and a
/// fragmentCount near a million can claim a 1 MiB receipt bitmap. Every
/// bound below exists because of that, and a fragment refused by one of
/// them is dropped and counted (`EnetStats::fragment_drops`) instead of
/// being buffered.
const MAX_FRAGMENT_COUNT: u32 = 1024;
/// Partial fragmented messages held per channel, keyed by
/// startSequenceNumber. An honest client fragments one message at a time
/// per channel, so this only bites a peer that opens many at once.
const MAX_PARTIAL_FRAGMENT_MESSAGES: usize = 4;
/// Incomplete fragment bytes held across the peer's channels (the
/// advertised totalLength of every partial message, summed): the hard
/// ceiling on the reassembly memory one peer can claim. A partial message
/// is created from a single fragment, so this — not the wire volume — is
/// what a hostile peer would otherwise spend.
const MAX_PARTIAL_FRAGMENT_BYTES: usize = 256 * 1024;

#[derive(Debug, PartialEq, Eq)]
pub enum EnetError {
    /// Datagram does not look like ENet protocol traffic at all.
    NonProtocol,
    /// Well-formed ENet header but invalid/mismatched content: drop it.
    Invalid,
}

/// Diagnostic counters for the protocol session: tells a mid-stream
/// disconnect story — frozen recv histogram + climbing duplicate count
/// means the client is retransmitting (our ACKs not accepted / network
/// stall); a healthy session shows ping/reliable counts advancing every
/// interval with ~zero duplicates.
#[derive(Default, Debug)]
pub struct EnetStats {
    pub connect: u64,
    pub acknowledge: u64,
    pub send_reliable: u64,
    pub send_reliable_by_channel: BTreeMap<u8, u64>,
    pub send_unreliable: u64,
    pub send_unsequenced: u64,
    pub send_fragment: u64,
    /// Fragmented messages (COMMAND_SEND_FRAGMENT) reassembled and handed
    /// to the application layer. The counterpart of `send_fragment`: the
    /// fragment count alone cannot tell "the client fragmented a message
    /// and we delivered it" from "the client fragmented a message and we
    /// ACKed and threw it away" (the defect this replaces), so the two
    /// must be read together.
    pub fragment_messages: u64,
    /// SEND_FRAGMENT arrivals NOT reassembled: already delivered (their
    /// whole sequence range is at/below the delivery cursor), a repeat of
    /// a fragment already held, inconsistent with the message in progress,
    /// or refused by a reassembly bound (`MAX_*` above). The counterpart
    /// of `send_fragment`, and deliberately NOT part of `window_discards`:
    /// no fragment arrival is a receive-window discard, because an honest
    /// client retransmits fragments whose ACKs were lost and the adaptive
    /// ladder must not read that as congestion.
    pub fragment_drops: u64,
    pub ping: u64,
    pub disconnect: u64,
    pub bandwidth_limit: u64,
    pub throttle_configure: u64,
    /// A re-send of a reliable sequence we had already seen: the exact
    /// retransmit of the last delivered command (deliver_reliable reaches
    /// it with `sequence == slot.incoming_reliable`) or a re-send of a
    /// command still sitting in the reorder buffer (`reorder.insert`
    /// returning a previous copy). Both set the `duplicate` flag and the
    /// one increment is at the end of `deliver_reliable`.
    ///
    /// Evidence, not a diagnostic: this and `window_discards` are the two
    /// counters the return path produces for the same retransmit pressure,
    /// seen at different points of the delivery cursor. A re-send that
    /// arrives while the cursor still sits on its sequence is counted here;
    /// the same sequence re-sent again after a newer command has been
    /// delivered is refused behind the cursor and counted there. They are
    /// different arrivals, so the congestion verdict
    /// (`adaptive::enet_window_congested`) consumes BOTH, added. One
    /// *sequence* can therefore be counted twice when it is re-sent across
    /// a cursor advance — intended, each arrival being its own event: a
    /// 5s window reading `dup=1176` beside ch1's 1176 behind-cursor
    /// discards need not be the same 1176.
    pub duplicate_reliable: u64,
    /// Reliable arrivals the receive rule refused, one increment per
    /// arrival (`record_discard`, from the two discard sites in
    /// `deliver_reliable`): behind the delivery cursor (the sequence was
    /// already delivered — the ACK that follows only catches the client up
    /// on ACKs it lost) or absurdly far ahead of the accepted watermark
    /// (those are NOT acked, so the client retransmits them). One of the
    /// two congestion counters: one refused re-send counts once here, and
    /// the verdict adds this to `duplicate_reliable`
    /// (`adaptive::enet_window_congested`).
    pub window_discards: u64,
    /// The same discards split by rule and channel: (behind the delivery
    /// cursor, more than MAX_AHEAD_OF_WATERMARK ahead of the accepted
    /// watermark). WHICH of the two fires on legitimate input traffic is
    /// still unknown — the measured 2026-09-14 session discarded 27-95
    /// reliables per 5s window while the user played, and the ladder read
    /// those discards as congestion — so this split is the evidence the
    /// next live session has to produce.
    pub discards_by_channel: BTreeMap<u8, (u64, u64)>,
    /// delivery cursor per channel (incomingReliableSequenceNumber): the
    /// last in-order DELIVERED seq — distinguishes a receipt/ACK stall
    /// from a delivery stall in the 5s stats
    pub next_expected: BTreeMap<u8, u16>,
    /// ACKs we have serialized to the client
    pub acks_sent: u64,
    /// highest incoming reliable sequence we have ACKed, per channel
    pub last_acked_incoming: BTreeMap<u8, u16>,
    /// datagrams that failed protocol parsing
    pub malformed: u64,
}

impl EnetStats {
    pub fn summary(&self) -> String {
        let reliable: Vec<String> = self
            .send_reliable_by_channel
            .iter()
            .map(|(channel, count)| format!("ch{channel}={count}"))
            .collect();
        let last_acked: Vec<String> = self
            .last_acked_incoming
            .iter()
            .map(|(channel, sequence)| format!("ch{channel}={sequence}"))
            .collect();
        let next_expected: Vec<String> = self
            .next_expected
            .iter()
            .map(|(channel, sequence)| format!("ch{channel}={sequence}"))
            .collect();
        // per-channel split of the discards by rule (behind the delivery
        // cursor / far ahead of the watermark): which one fires on
        // legitimate input traffic is the open question of the 2026-09-14
        // freeze, so it rides the 5s line next to the total.
        let discards: Vec<String> = self
            .discards_by_channel
            .iter()
            .map(|(channel, (behind, ahead))| format!("ch{channel}={behind}/{ahead}"))
            .collect();
        format!(
            "recv reliable[{}]={} fragments={} fragmented-delivered={} fragment-drops={} ping={} ack={} dup={} window-drops={} discards-behind/ahead[{}] | sent acks={} last-acked[{}] next-expected[{}] | malformed={}",
            reliable.join(","),
            self.send_reliable,
            self.send_fragment,
            self.fragment_messages,
            self.fragment_drops,
            self.ping,
            self.acknowledge,
            self.duplicate_reliable,
            self.window_discards,
            discards.join(","),
            self.acks_sent,
            last_acked.join(","),
            next_expected.join(","),
            self.malformed,
        )
    }
}

fn trace_malformed(data: &[u8]) {
    static DUMPED: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    if DUMPED.fetch_add(1, std::sync::atomic::Ordering::Relaxed) < 3 {
        eprintln!(
            "enet: malformed datagram ({} bytes): {:02x?}",
            data.len(),
            &data[..data.len().min(64)]
        );
    }
}

#[derive(Debug)]
pub enum EnetEvent {
    /// The client completed the handshake (ACKed our VERIFY_CONNECT).
    Connected { connect_data: u32 },
    /// In-order reliable payload on a channel.
    Payload { channel: u8, payload: Vec<u8> },
    /// The client disconnected or timed out.
    Disconnected,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PeerState {
    AcknowledgingConnect,
    Connected,
    Disconnecting,
}

#[derive(Debug)]
struct Channel {
    /// Delivery cursor (the reference's incomingReliableSequenceNumber,
    /// which is also dispatch-anchored): the last in-order DELIVERED
    /// reliable sequence.
    incoming_reliable: u16,
    /// Accepted watermark: highest reliable sequence accepted into the
    /// reorder buffer or delivered. Never advances on discards — a
    /// discarded (un-acked) sequence must not widen later accept
    /// decisions.
    highest_received: u16,
    outgoing_reliable: u16,
    reorder: BTreeMap<u16, Vec<u8>>,
    /// Last time incoming_reliable advanced; drives the stalled-channel
    /// diagnostic (watermark far ahead + empty reorder + no progress).
    last_advance: Instant,
    /// Set when a stall warning fires; cleared on the next advance so
    /// each stall episode logs once per channel.
    stall_warned: bool,
    /// Fragmented messages still being reassembled, keyed by
    /// startSequenceNumber. A fragmented message occupies the sequence
    /// range [start, start + fragmentCount - 1]: the client's fragment
    /// headers each carry their own reliable sequence number, consecutive
    /// from startSequenceNumber (cgutman/enet peer.c
    /// enet_peer_send_fragments + enet_peer_setup_outgoing_command), which
    /// is also what its per-fragment ACK bookkeeping expects. Bounded to
    /// MAX_PARTIAL_FRAGMENT_MESSAGES entries.
    fragments: BTreeMap<u16, PartialMessage>,
    /// Discards traced on this channel so far, capped at
    /// DISCARD_TRACE_LIMIT so a discard storm costs a compare per packet,
    /// not a line. The counts themselves live in
    /// `EnetStats::discards_by_channel` (the split the 5s stats line
    /// reports); only the trace budget is per-channel state.
    discards_traced: u32,
}

impl Channel {
    fn new(now: Instant) -> Self {
        Channel {
            incoming_reliable: 0,
            highest_received: 0,
            outgoing_reliable: 0,
            reorder: BTreeMap::new(),
            last_advance: now,
            stall_warned: false,
            fragments: BTreeMap::new(),
            discards_traced: 0,
        }
    }
}

/// One fragmented message (COMMAND_SEND_FRAGMENT) still being reassembled.
/// Its bytes arrive as `fragmentCount` fragments whose `fragmentOffset`s
/// tile `[0, totalLength)`, so the message is written straight into one
/// buffer as the fragments land and handed to the delivery path only when
/// `remaining` hits zero — a fragmented message reaches the application
/// layer exactly like an unfragmented reliable.
#[derive(Debug)]
struct PartialMessage {
    /// fragmentCount from the wire: how many reliable sequence numbers the
    /// message occupies, [start, start + fragment_count - 1].
    fragment_count: u32,
    /// totalLength from the wire; also the length of `data`. Charged
    /// against the peer's reassembly budget for as long as this lives.
    total_length: usize,
    /// Which fragments have arrived (the reference's fragment bitmap).
    /// Written positions are never overwritten: a repeat is ignored, so a
    /// duplicate can never decrement `remaining` twice.
    received: Vec<bool>,
    /// Fragments still missing; 0 = complete and deliverable.
    remaining: u32,
    /// The message bytes, indexed by fragmentOffset.
    data: Vec<u8>,
}

impl PartialMessage {
    /// Fragment offset of this fragment's last byte; the range check is
    /// the reference's (`fragmentOffset >= totalLength`, `dataLength >
    /// totalLength - fragmentOffset`).
    fn covers(&self, offset: usize, length: usize) -> bool {
        offset.checked_add(length).is_some_and(|end| end <= self.total_length)
    }
}

/// Outcome of one SEND_FRAGMENT arrival.
#[derive(Debug, PartialEq, Eq)]
enum FragmentVerdict {
    /// Written into a partial message (and delivered if it completed it):
    /// ACK it.
    Reassembled,
    /// Nothing to reassemble — the message's whole sequence range is
    /// already at/below the delivery cursor, or this fragment is a repeat
    /// of one already held — while the client still needs its ACK. Not a
    /// discard: the client retransmits fragments whose ACKs were lost, and
    /// `window_discards` feeds the congestion verdict.
    Ignored,
    /// Refused by a reassembly bound, or inconsistent with the message
    /// currently in progress. NOT ACKed on purpose: the client keeps the
    /// fragment in its reliable window and retransmits it, so the message
    /// can still complete once the state frees, instead of the ACK ending
    /// the retransmit and wedging the channel for good.
    Refused,
}

#[derive(Debug)]
struct PendingAck {
    channel: u8,
    reliable_sequence: u16,
    sent_time: u16,
}

#[derive(Debug)]
struct OutgoingCommand {
    command: u8,
    channel: u8,
    sequence: u16,
    body: Vec<u8>,
    last_sent: Option<Instant>,
    attempts: u32,
}

#[derive(Debug)]
struct Peer {
    address: SocketAddr,
    connect_id: u32,
    connect_data: u32,
    /// Header peerID value for server -> client datagrams (the client's
    /// own peer index, taken from CONNECT.outgoingPeerID).
    header_peer_id: u16,
    incoming_session: u8,
    outgoing_session: u8,
    state: PeerState,
    channels: Vec<Channel>,
    /// Peer-level reliable sequence number for channel 0xFF commands.
    outgoing_peer_sequence: u16,
    pending_acks: Vec<PendingAck>,
    outgoing: Vec<OutgoingCommand>,
    /// Negotiated MTU (min of both sides, clamped to our host MTU):
    /// outgoing datagrams are chunked to fit.
    mtu: u32,
    /// Advertised totalLength of every incomplete fragmented message on
    /// every channel, summed. Bounded by MAX_PARTIAL_FRAGMENT_BYTES: a
    /// partial message is created by a single fragment, so this — not the
    /// bytes that crossed the wire — is what a hostile peer would
    /// otherwise spend.
    partial_fragment_bytes: usize,
    last_receive: Instant,
    /// Address we migrated away from (same host IP, new port): datagrams
    /// from it are stale leftovers, not a new migration.
    abandoned_address: Option<SocketAddr>,
}

impl Peer {
    /// Mirrors enet_protocol_handle_connect: each side increments the
    /// session id provided by the peer (or its own fresh-peer 0xFF
    /// default) modulo 4, skipping the value it already had.
    fn fresh_sessions(connect_incoming_session: u8, connect_outgoing_session: u8) -> (u8, u8) {
        fn adjust(provided: u8, own_previous: u8) -> u8 {
            let mut session = if provided == 0xFF {
                own_previous
            } else {
                provided
            };
            session = session.wrapping_add(1) & 3;
            if session == own_previous {
                session = session.wrapping_add(1) & 3;
            }
            session
        }
        // fresh peers have incoming/outgoing session defaults of 0xFF
        let outgoing = adjust(connect_incoming_session, 0xFF);
        let incoming = adjust(connect_outgoing_session, 0xFF);
        (incoming, outgoing)
    }
}

/// The protocol core, independent of any socket so it can be unit tested.
#[derive(Default)]
pub struct EnetServer {
    peer: Option<Peer>,
    pub stats: EnetStats,
    /// Set when an outgoing command exhausted retransmits (peer dead).
    failure: bool,
}

impl EnetServer {
    pub fn new() -> Self {
        EnetServer {
            peer: None,
            stats: EnetStats::default(),
            failure: false,
        }
    }

    pub fn peer_connected(&self) -> bool {
        matches!(
            self.peer.as_ref().map(|peer| peer.state),
            Some(PeerState::Connected)
        )
    }

    pub fn peer_address(&self) -> Option<SocketAddr> {
        self.peer.as_ref().map(|peer| peer.address)
    }

    pub fn silent_for(&self, now: Instant) -> Option<Duration> {
        self.peer.as_ref().map(|peer| now.duration_since(peer.last_receive))
    }

    /// Snapshot of the per-channel reorder-buffer depths for the stats
    /// line (a wedge shows up as a large static depth).
    pub fn reorder_depths(&self) -> BTreeMap<u8, u16> {
        let mut depths = BTreeMap::new();
        if let Some(peer) = &self.peer {
            for (index, slot) in peer.channels.iter().enumerate() {
                if !slot.reorder.is_empty() {
                    depths.insert(index as u8, slot.reorder.len() as u16);
                }
            }
        }
        depths
    }

    /// Per-channel wedge diagnostic: a channel whose delivery cursor is
    /// far behind its accepted watermark with an EMPTY reorder buffer has
    /// lost messages it ACKed — the live input-channel wedge signature.
    /// Fires once per stall episode per channel; control.rs surfaces the
    /// lines on its 5s stats cadence.
    pub fn stall_warnings(&mut self, now: Instant) -> Vec<String> {
        let mut warnings = Vec::new();
        if let Some(peer) = &mut self.peer {
            for (index, slot) in peer.channels.iter_mut().enumerate() {
                let gap = slot.highest_received.wrapping_sub(slot.incoming_reliable);
                if gap > STALL_GAP_THRESHOLD
                    && slot.reorder.is_empty()
                    && !slot.stall_warned
                    && now.duration_since(slot.last_advance) >= STALL_WARN_AFTER
                {
                    slot.stall_warned = true;
                    warnings.push(format!(
                        "enet: WARNING ch{} stalled: delivered={} watermark={} gap={} with empty reorder buffer for >{}s (acked messages undeliverable)",
                        index,
                        slot.incoming_reliable,
                        slot.highest_received,
                        gap,
                        STALL_WARN_AFTER.as_secs(),
                    ));
                }
            }
        }
        warnings
    }

    /// Drops the peer without sending anything (timeout / session gone).
    pub fn reset(&mut self) {
        self.peer = None;
    }

    /// Queue a reliable control payload for delivery to the client.
    pub fn send_reliable(&mut self, channel: u8, payload: &[u8]) -> Result<(), EnetError> {
        let Some(peer) = self.peer.as_mut() else {
            return Err(EnetError::Invalid);
        };
        let Some(slot) = peer.channels.get(channel as usize) else {
            return Err(EnetError::Invalid);
        };
        let sequence = slot.outgoing_reliable.wrapping_add(1);
        peer.outgoing.push(OutgoingCommand {
            command: COMMAND_SEND_RELIABLE,
            channel,
            sequence,
            body: payload.to_vec(),
            last_sent: None,
            attempts: 0,
        });
        peer.channels[channel as usize].outgoing_reliable = sequence;
        Ok(())
    }

    pub fn handle_datagram(
        &mut self,
        from: SocketAddr,
        data: &[u8],
        now: Instant,
        events: &mut Vec<EnetEvent>,
    ) -> Result<(), EnetError> {
        if data.len() < 4 {
            return Err(EnetError::NonProtocol);
        }
        let header_peer_id = u16::from_be_bytes(data[0..2].try_into().unwrap());
        let session = ((header_peer_id & HEADER_SESSION_MASK) >> HEADER_SESSION_SHIFT) as u8;
        let peer_id = header_peer_id & MAXIMUM_PEER_ID;

        // The 16-bit sentTime field is only present when FLAG_SENT_TIME is
        // set; datagrams without it (e.g. the client's pure-ACK packets)
        // start their commands at offset 2. Parsing with a fixed offset of
        // 4 misaligns them into fake "kind 0" commands, discarding the
        // whole datagram un-acked — that stalled the client's reliable
        // window until its peer timeout killed the stream.
        let has_sent_time = header_peer_id & HEADER_FLAG_SENT_TIME != 0;
        let (sent_time, mut offset) = if has_sent_time {
            (
                u16::from_be_bytes(data[2..4].try_into().unwrap()),
                4usize,
            )
        } else {
            (0, 2)
        };

        if peer_id == MAXIMUM_PEER_ID {
            // Unconnected datagram: only CONNECT is valid here.
            return self.handle_connect(from, data, now, events);
        }

        let Some(peer) = self.peer.as_mut() else {
            return Err(EnetError::Invalid);
        };
        if peer.state == PeerState::Disconnecting {
            return Err(EnetError::Invalid);
        }
        if peer.address != from {
            // Reference behavior (cgutman/enet protocol.c:1052-1056):
            // once the peer/session checks pass, peer->address migrates to
            // the datagram's source address — the reference's address
            // equality check is commented out. A roaming client's source
            // port can change mid-session (WiFi rebind) while the session
            // id stays valid; rejecting those datagrams kills the control
            // channel permanently. Scope the migration to the port on the
            // same host IP (LAN threat model: a different host IP is still
            // rejected) and require the negotiated session id; an address
            // we already migrated away from is stale and rejected.
            if peer.address.ip() != from.ip()
                || peer.abandoned_address == Some(from)
                || peer.incoming_session != session
            {
                return Err(EnetError::Invalid);
            }
            eprintln!("enet: peer address migrated {} -> {}", peer.address, from);
            peer.abandoned_address = Some(peer.address);
            peer.address = from;
        }
        if peer.incoming_session != session {
            return Err(EnetError::Invalid);
        }

        // (channel, sequence, payload, wants-ack, sent_time) reliably
        // received but not yet delivered; applied after this borrow of
        // the peer ends. The ACK decision rides along so
        // deliver_reliable can suppress it for the discard band.
        let mut deliveries: Vec<(u8, u16, Vec<u8>, bool, u16)> = Vec::new();
        let mut disconnecting = false;
        while offset + 4 <= data.len() {
            let command = data[offset];
            let channel = data[offset + 1];
            let sequence = u16::from_be_bytes(data[offset + 2..offset + 4].try_into().unwrap());
            let kind = command & COMMAND_MASK;
            offset += 4;

            let body_len = match kind {
                COMMAND_ACKNOWLEDGE => 4,
                COMMAND_CONNECT => return Err(EnetError::Invalid),
                COMMAND_VERIFY_CONNECT => return Err(EnetError::Invalid),
                COMMAND_DISCONNECT => 4,
                COMMAND_PING => 0,
                COMMAND_SEND_RELIABLE => {
                    if offset + 2 > data.len() {
                        return Err(EnetError::Invalid);
                    }
                    u16::from_be_bytes(data[offset..offset + 2].try_into().unwrap()) as usize + 2
                }
                COMMAND_SEND_UNSEQUENCED => {
                    // {unsequencedGroup u16, dataLength u16, data}
                    if offset + 4 > data.len() {
                        return Err(EnetError::Invalid);
                    }
                    u16::from_be_bytes(data[offset + 2..offset + 4].try_into().unwrap()) as usize
                        + 4
                }
                COMMAND_SEND_UNRELIABLE => {
                    if offset + 4 > data.len() {
                        return Err(EnetError::Invalid);
                    }
                    u16::from_be_bytes(data[offset + 2..offset + 4].try_into().unwrap()) as usize + 4
                }
                COMMAND_SEND_FRAGMENT => {
                    // Reference layout (cgutman/enet protocol.h
                    // ENetProtocolSendFragment): {cmd hdr} {startSeq u16,
                    // dataLength u16, fragmentCount u32, fragmentNumber
                    // u32, totalLength u32, fragmentOffset u32} {data}.
                    // 20 fixed bytes after the command header; dataLength
                    // sits at body offset 2. The payload is REASSEMBLED
                    // (see `reassemble_fragment`) instead of skipped: the
                    // client fragments every message above its negotiated
                    // MTU, so skipping those payloads ACKed exactly the
                    // messages too big for one datagram and delivered
                    // nothing — the client believed they had been
                    // delivered and never retransmitted them.
                    if offset + 20 > data.len() {
                        return Err(EnetError::Invalid);
                    }
                    let start_sequence =
                        u16::from_be_bytes(data[offset..offset + 2].try_into().unwrap());
                    let fragment_length =
                        u16::from_be_bytes(data[offset + 2..offset + 4].try_into().unwrap())
                            as usize;
                    let fragment_count =
                        u32::from_be_bytes(data[offset + 4..offset + 8].try_into().unwrap());
                    let fragment_number =
                        u32::from_be_bytes(data[offset + 8..offset + 12].try_into().unwrap());
                    let total_length =
                        u32::from_be_bytes(data[offset + 12..offset + 16].try_into().unwrap());
                    let fragment_offset =
                        u32::from_be_bytes(data[offset + 16..offset + 20].try_into().unwrap());
                    if offset + 20 + fragment_length > data.len() {
                        return Err(EnetError::Invalid);
                    }
                    let payload = &data[offset + 20..offset + 20 + fragment_length];
                    offset += 20 + fragment_length;
                    self.stats.send_fragment += 1;
                    // Fields that cannot describe a position inside the
                    // message they belong to are a protocol error, not
                    // something to reassemble (the reference's
                    // `handle_send_fragment` returns -1 for all of them).
                    // The bounds a peer could otherwise abuse — a
                    // fragmentCount near a million, a totalLength claiming
                    // gigabytes — are enforced inside the reassembler so
                    // they can be counted and refused.
                    if fragment_count == 0
                        || fragment_number >= fragment_count
                        || total_length == 0
                        || fragment_offset >= total_length
                        || fragment_length as u32 > total_length - fragment_offset
                    {
                        return Err(EnetError::Invalid);
                    }
                    let fragment = Fragment {
                        sequence,
                        start: start_sequence,
                        count: fragment_count,
                        number: fragment_number,
                        total_length: total_length as usize,
                        offset: fragment_offset as usize,
                        data: payload,
                    };
                    let Some(slot) = peer.channels.get_mut(channel as usize) else {
                        // no such channel: nothing to reassemble into. Not
                        // ACKed, exactly like a reliable on a channel that
                        // does not exist (`deliver_reliable` returns
                        // without ACKing it either).
                        self.stats.fragment_drops += 1;
                        continue;
                    };
                    let verdict = reassemble_fragment(
                        &mut self.stats,
                        slot,
                        &mut peer.partial_fragment_bytes,
                        channel,
                        &fragment,
                        now,
                        events,
                    );
                    // The ACK rides RECEIPT, one per fragment, keyed on the
                    // fragment's own reliable sequence number — which is
                    // how the client's sender side accounts for fragments
                    // (each is its own outgoing command with its own
                    // sequence, cgutman/enet peer.c enet_peer_send_fragments
                    // + enet_peer_setup_outgoing_command). A fragment whose
                    // missing siblings never arrive therefore stays
                    // un-ACKed and is retransmitted.
                    if verdict != FragmentVerdict::Refused && command & FLAG_ACKNOWLEDGE != 0 {
                        self.stats
                            .last_acked_incoming
                            .entry(channel)
                            .and_modify(|highest| *highest = (*highest).max(sequence))
                            .or_insert(sequence);
                        peer.pending_acks.push(PendingAck {
                            channel,
                            reliable_sequence: sequence,
                            sent_time: if has_sent_time { sent_time } else { 0 },
                        });
                    }
                    continue;
                }
                COMMAND_BANDWIDTH_LIMIT => 8,
                COMMAND_THROTTLE_CONFIGURE => 12,
                _ => {
                    self.stats.malformed += 1;
                    trace_malformed(data);
                    return Err(EnetError::NonProtocol);
                }
            };
            if offset + body_len > data.len() {
                self.stats.malformed += 1;
                trace_malformed(data);
                return Err(EnetError::Invalid);
            }
            let body = &data[offset..offset + body_len];
            offset += body_len;

            // ACKs for SEND_RELIABLE are deferred to deliver_reliable,
            // which suppresses the ACK for its discard band (the
            // reference does the same in peer.c
            // enet_peer_queue_acknowledgement) so a discarded command is
            // retransmitted instead of lost forever.
            if command & FLAG_ACKNOWLEDGE != 0 && kind != COMMAND_SEND_RELIABLE {
                if kind == COMMAND_SEND_UNSEQUENCED {
                    // highest received per channel (never regress on
                    // retransmits — last write would under-report)
                    self.stats
                        .last_acked_incoming
                        .entry(channel)
                        .and_modify(|highest| *highest = (*highest).max(sequence))
                        .or_insert(sequence);
                }
                peer.pending_acks.push(PendingAck {
                    channel,
                    reliable_sequence: sequence,
                    sent_time: if has_sent_time { sent_time } else { 0 },
                });
            }

            match kind {
                COMMAND_ACKNOWLEDGE => {
                    self.stats.acknowledge += 1;
                    let acked_seq = u16::from_be_bytes(body[0..2].try_into().unwrap());
                    if peer.state == PeerState::AcknowledgingConnect
                        && channel == 0xFF
                        && acked_seq == 1
                    {
                        peer.state = PeerState::Connected;
                        eprintln!("enet: VERIFY_CONNECT acked by {from}, peer connected");
                        events.push(EnetEvent::Connected {
                            connect_data: peer.connect_data,
                        });
                    }
                    peer.outgoing
                        .retain(|outgoing| outgoing.sequence != acked_seq || outgoing.channel != channel);
                }
                COMMAND_SEND_RELIABLE => {
                    self.stats.send_reliable += 1;
                    *self
                        .stats
                        .send_reliable_by_channel
                        .entry(channel)
                        .or_default() += 1;
                    deliveries.push((
                        channel,
                        sequence,
                        body[2..].to_vec(),
                        command & FLAG_ACKNOWLEDGE != 0,
                        sent_time,
                    ));
                }
                COMMAND_DISCONNECT => {
                    self.stats.disconnect += 1;
                    peer.state = PeerState::Disconnecting;
                    disconnecting = true;
                }
                COMMAND_PING => self.stats.ping += 1,
                COMMAND_BANDWIDTH_LIMIT => self.stats.bandwidth_limit += 1,
                COMMAND_THROTTLE_CONFIGURE => self.stats.throttle_configure += 1,
                COMMAND_SEND_UNRELIABLE => {
                    self.stats.send_unreliable += 1;
                    let payload = body[4..].to_vec();
                    events.push(EnetEvent::Payload { channel, payload });
                }
                COMMAND_SEND_UNSEQUENCED => {
                    // No ordering, no ACKs: deliver immediately. The
                    // client carries encrypted input packets here (the
                    // 0x0001 AES-GCM envelope routed by
                    // handle_control_payload).
                    self.stats.send_unsequenced += 1;
                    let payload = body[4..].to_vec();
                    events.push(EnetEvent::Payload { channel, payload });
                }
                _ => {}
            }
        }
        for (channel, sequence, payload, wants_ack, sent_time) in deliveries {
            self.deliver_reliable(channel, sequence, payload, wants_ack, sent_time, now, events);
        }
        if disconnecting {
            events.push(EnetEvent::Disconnected);
        }
        // liveness only counts fully parsed datagrams: duplicates and
        // malformed packets must not keep a dead session looking alive
        if let Some(peer) = self.peer.as_mut() {
            peer.last_receive = now;
        }
        Ok(())
    }

    /// In-order per-channel reliable delivery with a reorder buffer.
    ///
    /// Receive rule (supersedes the straight reference port — the
    /// reference bounds its accept range to [cursor, cursor + FREE - 1)
    /// windows but suppresses ACKs in the discard band, peer.c
    /// enet_peer_queue_acknowledgement, so discarded commands come back;
    /// we ACK on receipt and therefore must never discard anything an
    /// honest client can still be sending):
    ///
    /// - expected (delivery cursor + 1): deliver and drain the reorder
    ///   buffer; ACK.
    /// - exact retransmit of the last delivered sequence: duplicate; ACK.
    /// - more than ACCEPT_RELIABLE_RANGE behind the delivery cursor
    ///   (i.e. at/below it in sequence space): already delivered — the
    ///   reference window-discards these too; ACK, which merely catches
    ///   the client up on ACKs it lost.
    /// - within (cursor, cursor + ACCEPT_RELIABLE_RANGE] but more than
    ///   MAX_AHEAD_OF_WATERMARK ahead of the accepted watermark: absurd
    ///   for an honest peer (its counter is sequential, so reaching here
    ///   takes a ~28k-message loss run) — the anti-garbage bound.
    ///   Discard and DO NOT ACK; the client retransmits until the cursor
    ///   advances into range. This is what keeps the invariant
    ///   "acked ⇒ eventually delivered".
    /// - anything else: buffer in the reorder buffer and ACK on receipt.
    ///
    /// Reliables are only half of the ordered stream: a fragmented message
    /// holds one sequence number per fragment (see [`drain_in_order`]), so
    /// this path shares the delivery drain with the reassembler — a
    /// completed message sitting at cursor + 1 is delivered by the same
    /// loop that drains buffered reliables, and vice versa.
    fn deliver_reliable(
        &mut self,
        channel: u8,
        sequence: u16,
        payload: Vec<u8>,
        wants_ack: bool,
        sent_time: u16,
        now: Instant,
        events: &mut Vec<EnetEvent>,
    ) {
        let Some(peer) = self.peer.as_mut() else {
            return;
        };
        let Some(slot) = peer.channels.get_mut(channel as usize) else {
            return;
        };
        let expected = slot.incoming_reliable.wrapping_add(1);
        let mut duplicate = false;
        let mut ack = wants_ack;
        if sequence == expected {
            let cursor_before = slot.incoming_reliable;
            slot.incoming_reliable = sequence;
            events.push(EnetEvent::Payload { channel, payload });
            // drain reordered packets and completed fragmented messages
            // that are now in sequence
            drain_in_order(
                &mut self.stats,
                channel,
                slot,
                &mut peer.partial_fragment_bytes,
                now,
                events,
                cursor_before,
            );
        } else if sequence == slot.incoming_reliable {
            // exact retransmit of the last delivered command
            duplicate = true;
        } else if sequence.wrapping_sub(slot.incoming_reliable) > ACCEPT_RELIABLE_RANGE {
            // behind the delivery cursor: in-order delivery already
            // passed this sequence; the reference window-discards it too
            record_discard(&mut self.stats, slot, channel, sequence, false);
        } else {
            let ahead = sequence.wrapping_sub(slot.highest_received);
            if ahead <= ACCEPT_RELIABLE_RANGE && ahead > MAX_AHEAD_OF_WATERMARK {
                // absurdly far ahead of everything accepted so far:
                // discard and suppress the ACK so the client retransmits
                // (reference discard-band ACK suppression)
                record_discard(&mut self.stats, slot, channel, sequence, true);
                ack = false;
            } else {
                slot.highest_received = advance_watermark(slot.highest_received, sequence);
                if slot.reorder.insert(sequence, payload).is_some() {
                    duplicate = true;
                }
            }
        }
        if ack {
            peer.pending_acks.push(PendingAck {
                channel,
                reliable_sequence: sequence,
                sent_time,
            });
            // highest ACKed per channel (never regress on retransmits)
            self.stats
                .last_acked_incoming
                .entry(channel)
                .and_modify(|highest| *highest = (*highest).max(sequence))
                .or_insert(sequence);
        }
        if duplicate {
            // same reliable sequence twice while still buffered: the
            // client retransmitted, meaning it never saw our ACK
            self.stats.duplicate_reliable += 1;
        }
    }

    fn handle_connect(
        &mut self,
        from: SocketAddr,
        data: &[u8],
        now: Instant,
        _events: &mut Vec<EnetEvent>,
    ) -> Result<(), EnetError> {
        // Expect exactly one command: CONNECT (48 bytes after the
        // variable-length ENet header: 4-byte command header + 44-byte
        // connect body).
        let header_len = if data[0] as u16 & (HEADER_FLAG_SENT_TIME >> 8) != 0 {
            4
        } else {
            2
        };
        if data.len() != header_len + 48 {
            return Err(EnetError::NonProtocol);
        }
        if data[header_len] & COMMAND_MASK != COMMAND_CONNECT {
            return Err(EnetError::NonProtocol);
        }
        let connect = &data[header_len + 4..];
        let _outgoing_peer_id = u16::from_be_bytes(connect[0..2].try_into().unwrap());
        let connect_incoming_session = connect[2];
        let connect_outgoing_session = connect[3];
        let mtu = u32::from_be_bytes(connect[4..8].try_into().unwrap());
        let window_size = u32::from_be_bytes(connect[8..12].try_into().unwrap());
        let channel_count =
            u32::from_be_bytes(connect[12..16].try_into().unwrap()) as usize;
        let connect_id = u32::from_be_bytes(connect[36..40].try_into().unwrap());
        let connect_data = u32::from_be_bytes(connect[40..44].try_into().unwrap());

        eprintln!(
            "enet: CONNECT from {from} (channels={channel_count}, mtu={mtu}, window={window_size}, connect_id={connect_id}, data={connect_data:#x})"
        );
        self.stats.connect += 1;

        if channel_count < 1 || channel_count > MAXIMUM_CHANNEL_COUNT {
            return Err(EnetError::Invalid);
        }
        if let Some(peer) = &self.peer {
            if peer.address == from && peer.connect_id == connect_id {
                // Duplicate CONNECT retransmit: re-send the verify.
                eprintln!("enet: duplicate CONNECT from {from}, re-sending VERIFY_CONNECT");
                return Ok(());
            }
            if peer.address == from && peer.state != PeerState::Disconnecting {
                // Reference duplicate-peer behavior (protocol.c
                // handle_connect): a fresh CONNECT from the same address
                // with a new connectID resets the old peer and starts a
                // new handshake (client reconnect after a lost session).
                eprintln!(
                    "enet: reconnect from {from} (new connect_id {connect_id}), resetting old peer"
                );
                self.peer = None;
            } else if peer.state != PeerState::Disconnecting {
                eprintln!("enet: CONNECT from {from} rejected: peer slot busy with {}", peer.address);
                return Err(EnetError::Invalid);
            }
        }

        let (incoming_session, outgoing_session) =
            Peer::fresh_sessions(connect_incoming_session, connect_outgoing_session);
        eprintln!(
            "enet: CONNECT accepted from {from} (sessions server->client {incoming_session}, client->server {outgoing_session})"
        );

        let mtu = mtu.clamp(MINIMUM_MTU, MAXIMUM_MTU).min(HOST_MTU);
        let window_size = window_size
            .clamp(MINIMUM_WINDOW_SIZE, MAXIMUM_WINDOW_SIZE)
            .min(MAXIMUM_WINDOW_SIZE);

        let mut peer = Peer {
            address: from,
            connect_id,
            connect_data,
            header_peer_id: _outgoing_peer_id,
            incoming_session,
            outgoing_session,
            state: PeerState::AcknowledgingConnect,
            channels: (0..channel_count).map(|_| Channel::new(now)).collect(),
            outgoing_peer_sequence: 0,
            pending_acks: Vec::new(),
            outgoing: Vec::new(),
            mtu,
            partial_fragment_bytes: 0,
            last_receive: now,
            abandoned_address: None,
        };

        // ACK the CONNECT command (command header sits right after the
        // variable-length header).
        let connect_sequence = u16::from_be_bytes(
            data[header_len + 2..header_len + 4].try_into().unwrap(),
        );
        let sent_time = if header_len == 4 {
            u16::from_be_bytes(data[2..4].try_into().unwrap())
        } else {
            0
        };
        peer.pending_acks.push(PendingAck {
            channel: 0xFF,
            reliable_sequence: connect_sequence,
            sent_time,
        });

        // VERIFY_CONNECT body (40 bytes after the command header).
        peer.outgoing_peer_sequence = 1;
        let mut body = Vec::with_capacity(40);
        body.extend_from_slice(&0u16.to_be_bytes()); // outgoingPeerID (our index)
        body.push(incoming_session); // server -> client session
        body.push(outgoing_session); // client -> server session
        body.extend_from_slice(&mtu.to_be_bytes());
        body.extend_from_slice(&window_size.to_be_bytes());
        body.extend_from_slice(&(channel_count as u32).to_be_bytes());
        body.extend_from_slice(&0u32.to_be_bytes()); // incomingBandwidth
        body.extend_from_slice(&0u32.to_be_bytes()); // outgoingBandwidth
        body.extend_from_slice(&THROTTLE_INTERVAL.to_be_bytes());
        body.extend_from_slice(&THROTTLE_ACCELERATION.to_be_bytes());
        body.extend_from_slice(&THROTTLE_DECELERATION.to_be_bytes());
        body.extend_from_slice(&connect_id.to_be_bytes());
        peer.outgoing.push(OutgoingCommand {
            command: COMMAND_VERIFY_CONNECT,
            channel: 0xFF,
            sequence: peer.outgoing_peer_sequence,
            body,
            last_sent: None,
            attempts: 0,
        });

        self.peer = Some(peer);
        Ok(())
    }

    /// Builds all datagrams pending for the peer: queued ACKs, new
    /// outgoing commands and retransmissions. Single send batch per call.
    pub fn flush(&mut self, now: Instant) -> Vec<Vec<u8>> {
        let Some(peer) = self.peer.as_mut() else {
            return Vec::new();
        };
        if peer.state == PeerState::Disconnecting {
            // Send the ACK of the client's DISCONNECT once, then forget.
            let acks = std::mem::take(&mut peer.pending_acks);
            let datagram = serialize_datagram(peer, acks, &[]);
            self.peer = None;
            return vec![datagram];
        }

        let mut datagrams = Vec::new();
        let ack_count = peer.pending_acks.len();
        let acks = std::mem::take(&mut peer.pending_acks);

        let mut commands: Vec<&OutgoingCommand> = Vec::new();
        for command in &peer.outgoing {
            let due = command
                .last_sent
                .is_none_or(|sent| now.duration_since(sent) >= RETRANSMIT_TIMEOUT);
            if due {
                commands.push(command);
            }
        }

        // Chunk at the negotiated MTU (never above 1400 even if the peer
        // negotiated more, to stay conservative on the wire).
        let max_datagram = (peer.mtu as usize).clamp(576, 1400);
        let mut datagram = serialize_datagram(peer, acks, &[]);
        for command in commands {
            let size = 6 + command.body.len();
            if datagram.len() + size > max_datagram {
                datagrams.push(std::mem::replace(
                    &mut datagram,
                    serialize_datagram(peer, Vec::new(), &[]),
                ));
            }
            serialize_command(&mut datagram, command);
        }
        datagrams.push(datagram);
        self.stats.acks_sent += ack_count as u64;

        // Mark sent / drop commands that exhausted retransmits.
        if let Some(peer) = self.peer.as_mut() {
            let mut failed = false;
            for command in &mut peer.outgoing {
                if command.last_sent.is_none()
                    || now.duration_since(command.last_sent.unwrap()) >= RETRANSMIT_TIMEOUT
                {
                    command.last_sent = Some(now);
                    command.attempts += 1;
                    if command.attempts > MAX_RETRANSMITS {
                        failed = true;
                    }
                }
            }
            if failed {
                eprintln!("enet: peer stopped acknowledging, dropping");
                self.peer = None;
                // let the caller end the session with an event instead of
                // silently losing the control channel
                self.failure = true;
            }
        }
        datagrams
    }

    /// True once when an outgoing command exhausted retransmits (the
    /// peer is gone); the control loop ends the session on this.
    pub fn take_failure(&mut self) -> bool {
        let failure = self.failure;
        self.failure = false;
        failure
    }
}

/// Forward-distance maximum in 16-bit sequence space: `candidate` wins
/// when it sits within half the space (ACCEPT_RELIABLE_RANGE, distance 0
/// included) ahead of `watermark`, so the watermark never regresses and
/// never jumps across the wrap ambiguity.
fn advance_watermark(watermark: u16, candidate: u16) -> u16 {
    if candidate.wrapping_sub(watermark) <= ACCEPT_RELIABLE_RANGE {
        candidate
    } else {
        watermark
    }
}

/// Records one receive-window discard: the global total, the per-channel
/// split by rule, and a bounded trace. `ahead` selects the rule — false is
/// "behind the delivery cursor" (in-order delivery already passed this
/// sequence; the arrival is ACKed anyway), true is "more than
/// MAX_AHEAD_OF_WATERMARK ahead of the accepted watermark" (the arrival is
/// NOT acked, so the client retransmits it). WHICH of the two fires on
/// legitimate input traffic is still unknown: the measured 2026-09-14
/// session discarded 27-95 reliables per 5s window while the user played,
/// and the adaptive ladder read those discards as congestion — the first
/// DISCARD_TRACE_LIMIT discards per channel (with both cursors and the
/// rule) are the evidence the next live session has to produce, and after
/// the cap the trace costs one compare per packet and only the counters
/// move on. The path is `eprintln!`, same as every other enet diagnostic.
fn record_discard(
    stats: &mut EnetStats,
    slot: &mut Channel,
    channel: u8,
    sequence: u16,
    ahead: bool,
) {
    stats.window_discards += 1;
    let split = stats.discards_by_channel.entry(channel).or_default();
    if ahead {
        split.1 += 1;
    } else {
        split.0 += 1;
    }
    if slot.discards_traced < DISCARD_TRACE_LIMIT {
        slot.discards_traced += 1;
        eprintln!(
            "enet: ch{channel} discard #{}/{DISCARD_TRACE_LIMIT} seq={sequence} cursor={} watermark={} ({})",
            slot.discards_traced,
            slot.incoming_reliable,
            slot.highest_received,
            if ahead {
                "ahead-of-watermark"
            } else {
                "behind-cursor"
            },
        );
    }
}

/// One parsed SEND_FRAGMENT arrival. Borrows its bytes out of the
/// datagram, so nothing is copied until the fragment is accepted.
struct Fragment<'a> {
    /// The fragment command's own header sequence number. The client's
    /// sender side assigns one reliable sequence per fragment, consecutive
    /// from startSequenceNumber (cgutman/enet peer.c
    /// enet_peer_send_fragments + enet_peer_setup_outgoing_command), so
    /// this is `start + number` in practice — and it is what the ACK and
    /// the accepted watermark use.
    sequence: u16,
    /// startSequenceNumber: fragment 0's sequence, and the sequence the
    /// assembled message is delivered under.
    start: u16,
    count: u32,
    number: u32,
    total_length: usize,
    offset: usize,
    data: &'a [u8],
}

/// Counts one refused fragment arrival and names the reason, throttled the
/// way every other budget in this file is (first + every 100th): a hostile
/// or buggy peer can refuse thousands per second, and the refusal itself
/// is already the evidence.
fn note_fragment_refusal(stats: &mut EnetStats, channel: u8, fragment: &Fragment, reason: &str) {
    stats.fragment_drops += 1;
    if stats.fragment_drops == 1 || stats.fragment_drops % 100 == 0 {
        eprintln!(
            "enet: ch{channel} fragment refused ({reason}) start={} fragment={}/{} offset={} total={} (refused {})",
            fragment.start,
            fragment.number,
            fragment.count,
            fragment.offset,
            fragment.total_length,
            stats.fragment_drops,
        );
    }
}

/// Reassembles one SEND_FRAGMENT arrival into the channel's partial
/// message table, delivering the message through the ordered path as soon
/// as its last fragment lands (see [`drain_in_order`] for how a message
/// takes its place in the sequence stream).
///
/// Nothing here is counted as a receive-window discard, and no fragment
/// arrival is refused for a window reason: fragments are ACKed on receipt
/// and an honest client only retransmits a fragment when its ACK was lost,
/// so feeding fragments to `window_discards` would report normal
/// retransmission as congestion to the adaptive ladder. What IS refused is
/// state a peer could use to exhaust memory — the bounds in the constants
/// above — and a refusal is deliberately NOT ACKed, so the client keeps
/// retransmitting and the message can still complete once the state frees
/// (ACKing it would end the retransmit and wedge the channel behind a
/// message that can never be delivered).
fn reassemble_fragment(
    stats: &mut EnetStats,
    slot: &mut Channel,
    budget: &mut usize,
    channel: u8,
    fragment: &Fragment,
    now: Instant,
    events: &mut Vec<EnetEvent>,
) -> FragmentVerdict {
    let cursor_before = slot.incoming_reliable;
    let end = fragment
        .start
        .wrapping_add((fragment.count - 1) as u16);
    // The whole range is at/below the delivery cursor: this message was
    // already delivered (a retransmit whose ACK we lost) or the cursor
    // jumped past it (it can never be delivered now). Nothing to
    // reassemble; the caller ACKs, which only catches the client up on an
    // ACK it lost — the same rule `deliver_reliable` applies behind the
    // cursor, deliberately without a `window_discards` increment.
    if slot.incoming_reliable.wrapping_sub(end) <= ACCEPT_RELIABLE_RANGE {
        return FragmentVerdict::Ignored;
    }
    if fragment.count > MAX_FRAGMENT_COUNT {
        note_fragment_refusal(stats, channel, fragment, "fragmentCount over the reassembly cap");
        return FragmentVerdict::Refused;
    }
    // Two steps, not one match on `get_mut`: the create path needs the
    // whole map (its length, and the insert), and a borrow held across a
    // match arm cannot coexist with that.
    if !slot.fragments.contains_key(&fragment.start) {
        if slot.fragments.len() >= MAX_PARTIAL_FRAGMENT_MESSAGES {
            note_fragment_refusal(
                stats,
                channel,
                fragment,
                "too many messages being reassembled on this channel",
            );
            return FragmentVerdict::Refused;
        }
        if *budget + fragment.total_length > MAX_PARTIAL_FRAGMENT_BYTES {
            note_fragment_refusal(stats, channel, fragment, "reassembly budget exhausted");
            return FragmentVerdict::Refused;
        }
        *budget += fragment.total_length;
        slot.fragments.insert(
            fragment.start,
            PartialMessage {
                fragment_count: fragment.count,
                total_length: fragment.total_length,
                received: vec![false; fragment.count as usize],
                remaining: fragment.count,
                data: vec![0u8; fragment.total_length],
            },
        );
    }
    let message = slot
        .fragments
        .get_mut(&fragment.start)
        .expect("message present: created above or in progress");
    if message.fragment_count != fragment.count || message.total_length != fragment.total_length {
        // A different message reusing a sequence number we are already
        // reassembling: the reference treats this as a protocol error
        // (protocol.c handle_send_fragment returns -1). We drop only this
        // arrival and keep the message in progress, so the datagram's
        // co-packed ACKs survive it.
        note_fragment_refusal(
            stats,
            channel,
            fragment,
            "inconsistent with the message in progress",
        );
        return FragmentVerdict::Refused;
    }
    if message.received[fragment.number as usize] {
        // Already held: its ACK was lost and the client retransmitted.
        // Idempotent — `remaining` is decremented once per fragment
        // number, never once per arrival, and the bytes are not rewritten.
        return FragmentVerdict::Ignored;
    }
    if !message.covers(fragment.offset, fragment.data.len()) {
        note_fragment_refusal(stats, channel, fragment, "fragment outside the message");
        return FragmentVerdict::Refused;
    }
    message.data[fragment.offset..fragment.offset + fragment.data.len()]
        .copy_from_slice(fragment.data);
    message.received[fragment.number as usize] = true;
    message.remaining -= 1;
    // The fragment's own sequence number is accepted (whatever the
    // assembled message's span is): keeping the accepted watermark in step
    // with receipt is what makes the stalled-channel diagnostic read a
    // channel whose message never completes.
    slot.highest_received = advance_watermark(slot.highest_received, fragment.sequence);
    drain_in_order(stats, channel, slot, budget, now, events, cursor_before);
    FragmentVerdict::Reassembled
}

/// Advances the delivery cursor through everything it can now reach in
/// order and does the bookkeeping an advance implies (accepted watermark,
/// stale-entry cleanup, the stalled-channel clock). Returns true when the
/// cursor moved.
///
/// Two kinds of entry live in the stream:
///
/// - a reliable buffered in the reorder map, at exactly cursor + 1: it
///   becomes the cursor and its payload is delivered.
/// - a COMPLETE fragmented message starting at cursor + 1: it is delivered
///   as one payload and the cursor jumps to its last fragment's sequence
///   number (`start + fragmentCount - 1`). The client's fragment headers
///   carry consecutive reliable sequence numbers from startSequenceNumber
///   and its own dispatcher advances `incomingReliableSequenceNumber` by
///   `fragmentCount - 1` on dispatch (cgutman/enet peer.c
///   enet_peer_dispatch_incoming_reliable_commands), so a message's
///   fragment numbers are consumed by it and never arrive as commands of
///   their own.
///
/// The loop stops at the first sequence it cannot deliver — including an
/// INCOMPLETE message starting at cursor + 1, which must hold the cursor
/// at its start - 1 so nothing behind it can overtake it.
///
/// `cursor_before` is the delivery cursor as it was BEFORE the caller's own
/// move (a reliable's in-order arrival moves it first, the reassembler does
/// not move it at all), so that a call which delivers nothing extra still
/// runs the bookkeeping for the caller's move.
fn drain_in_order(
    stats: &mut EnetStats,
    channel: u8,
    slot: &mut Channel,
    budget: &mut usize,
    now: Instant,
    events: &mut Vec<EnetEvent>,
    cursor_before: u16,
) -> bool {
    loop {
        let next = slot.incoming_reliable.wrapping_add(1);
        if let Some(message) = slot.fragments.get(&next) {
            if message.remaining > 0 {
                break;
            }
        }
        if let Some(message) = slot.fragments.remove(&next) {
            *budget -= message.total_length;
            slot.incoming_reliable = next.wrapping_add((message.fragment_count - 1) as u16);
            stats.fragment_messages += 1;
            events.push(EnetEvent::Payload {
                channel,
                payload: message.data,
            });
            continue;
        }
        match slot.reorder.remove(&next) {
            Some(pending) => {
                slot.incoming_reliable = next;
                events.push(EnetEvent::Payload {
                    channel,
                    payload: pending,
                });
            }
            None => break,
        }
    }
    if slot.incoming_reliable == cursor_before {
        return false;
    }
    slot.highest_received = advance_watermark(slot.highest_received, slot.incoming_reliable);
    // drop stale buffered copies at/below the new cursor (an early arrival
    // retransmitted exactly when it became expected never reaches the
    // drain path), and partial messages the cursor just passed: they can
    // never be delivered now, and holding them would keep the reassembly
    // budget and the per-channel message count hostage.
    let next = slot.incoming_reliable.wrapping_add(1);
    slot.reorder = slot.reorder.split_off(&next);
    let cursor = slot.incoming_reliable;
    let mut freed = 0usize;
    slot.fragments.retain(|&start, message| {
        let end = start.wrapping_add((message.fragment_count - 1) as u16);
        let keep = cursor.wrapping_sub(end) > ACCEPT_RELIABLE_RANGE;
        if !keep {
            freed += message.total_length;
        }
        keep
    });
    *budget -= freed;
    slot.last_advance = now;
    slot.stall_warned = false;
    stats.next_expected.insert(channel, slot.incoming_reliable);
    true
}

fn serialize_datagram(
    peer: &Peer,
    acks: Vec<PendingAck>,
    commands: &[&OutgoingCommand],
) -> Vec<u8> {
    let mut datagram = Vec::with_capacity(64);
    let header_peer_id = peer.header_peer_id
        | ((peer.outgoing_session as u16) << HEADER_SESSION_SHIFT)
        | HEADER_FLAG_SENT_TIME;
    datagram.extend_from_slice(&header_peer_id.to_be_bytes());
    let start = now_duration_millis();
    datagram.extend_from_slice(&start.to_be_bytes());
    for ack in acks {
        datagram.push(COMMAND_ACKNOWLEDGE);
        datagram.push(ack.channel);
        datagram.extend_from_slice(&ack.reliable_sequence.to_be_bytes());
        datagram.extend_from_slice(&ack.reliable_sequence.to_be_bytes());
        datagram.extend_from_slice(&ack.sent_time.to_be_bytes());
    }
    for command in commands {
        serialize_command(&mut datagram, command);
    }
    datagram
}

fn now_duration_millis() -> u16 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u16)
        .unwrap_or(0)
}

fn serialize_command(datagram: &mut Vec<u8>, command: &OutgoingCommand) {
    datagram.push(command.command | FLAG_ACKNOWLEDGE);
    datagram.push(command.channel);
    datagram.extend_from_slice(&command.sequence.to_be_bytes());
    if command.command == COMMAND_SEND_RELIABLE {
        datagram.extend_from_slice(&(command.body.len() as u16).to_be_bytes());
    }
    datagram.extend_from_slice(&command.body);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn connect_datagram(session_in: u8, session_out: u8, connect_id: u32, data: u32) -> Vec<u8> {
        connect_datagram_with_channels(session_in, session_out, connect_id, data, 4)
    }

    fn connect_datagram_with_channels(
        session_in: u8,
        session_out: u8,
        connect_id: u32,
        data: u32,
        channels: u32,
    ) -> Vec<u8> {
        let mut packet = Vec::new();
        packet.extend_from_slice(&0xFFFFu16.to_be_bytes());
        packet.extend_from_slice(&0x1234u16.to_be_bytes()); // sentTime
        packet.push(COMMAND_CONNECT | FLAG_ACKNOWLEDGE);
        packet.push(0xFF);
        packet.extend_from_slice(&1u16.to_be_bytes()); // reliable seq
        packet.extend_from_slice(&0u16.to_be_bytes()); // outgoingPeerID
        packet.push(session_in);
        packet.push(session_out);
        packet.extend_from_slice(&1392u32.to_be_bytes()); // mtu
        packet.extend_from_slice(&32768u32.to_be_bytes()); // windowSize
        packet.extend_from_slice(&channels.to_be_bytes()); // channelCount
        packet.extend_from_slice(&0u32.to_be_bytes()); // incomingBandwidth
        packet.extend_from_slice(&0u32.to_be_bytes()); // outgoingBandwidth
        packet.extend_from_slice(&THROTTLE_INTERVAL.to_be_bytes());
        packet.extend_from_slice(&THROTTLE_ACCELERATION.to_be_bytes());
        packet.extend_from_slice(&THROTTLE_DECELERATION.to_be_bytes());
        packet.extend_from_slice(&connect_id.to_be_bytes());
        packet.extend_from_slice(&data.to_be_bytes());
        packet
    }

    fn header_session(packet: &[u8]) -> u8 {
        ((u16::from_be_bytes(packet[0..2].try_into().unwrap()) & HEADER_SESSION_MASK)
            >> HEADER_SESSION_SHIFT) as u8
    }

    fn ack_of_verify(packet: &[u8]) -> Vec<u8> {
        // Find the VERIFY_CONNECT command seq and ACK it from the client side.
        let seq = 1u16; // first server command
        let mut out = Vec::new();
        let session = header_session(packet);
        out.extend_from_slice(&((0u16 | (session as u16) << HEADER_SESSION_SHIFT) | HEADER_FLAG_SENT_TIME).to_be_bytes());
        out.extend_from_slice(&0x5678u16.to_be_bytes());
        out.push(COMMAND_ACKNOWLEDGE);
        out.push(0xFF);
        out.extend_from_slice(&0u16.to_be_bytes());
        out.extend_from_slice(&seq.to_be_bytes());
        out.extend_from_slice(&0x1234u16.to_be_bytes());
        out
    }

    #[test]
    fn connect_handshake_produces_verify_connect_and_ack() {
        let mut server = EnetServer::new();
        let now = Instant::now();
        let mut events = Vec::new();

        server
            .handle_datagram(
                "127.0.0.1:6000".parse().unwrap(),
                &connect_datagram(0xFF, 0xFF, 42, 0xDEAD),
                now,
                &mut events,
            )
            .unwrap();
        assert!(events.is_empty());
        assert!(!server.peer_connected());

        let datagrams = server.flush(now);
        assert_eq!(datagrams.len(), 1);
        let datagram = &datagrams[0];
        assert_eq!(header_session(datagram), 0); // negotiated session id
        // header (4) + ACK(8) + VERIFY_CONNECT command header (4) + body (40)
        assert_eq!(datagram.len(), 4 + 8 + 44);
        assert_eq!(datagram[4], COMMAND_ACKNOWLEDGE);
        assert_eq!(datagram[5], 0xFF);
        assert_eq!(u16::from_be_bytes(datagram[6..8].try_into().unwrap()), 1);
        assert_eq!(datagram[12] & COMMAND_MASK, COMMAND_VERIFY_CONNECT);
        assert_eq!(datagram[13], 0xFF);
        let body = &datagram[16..];
        assert_eq!(u16::from_be_bytes(body[0..2].try_into().unwrap()), 0); // our peer id
        assert_eq!(body[2], 0); // incomingSession (server->client)
        assert_eq!(body[3], 0); // outgoingSession (client->server)
        assert_eq!(u32::from_be_bytes(body[4..8].try_into().unwrap()), 1392);
        assert_eq!(u32::from_be_bytes(body[12..16].try_into().unwrap()), 4); // channels
        assert_eq!(u32::from_be_bytes(body[36..40].try_into().unwrap()), 42); // connectID

        // client ACKs the verify connect -> Connected
        server
            .handle_datagram(
                "127.0.0.1:6000".parse().unwrap(),
                &ack_of_verify(datagram),
                now,
                &mut events,
            )
            .unwrap();
        assert!(matches!(events.as_slice(), [EnetEvent::Connected { connect_data }] if *connect_data == 0xDEAD));
        assert!(server.peer_connected());
    }

    #[test]
    fn reliable_payloads_are_delivered_in_order() {
        let mut server = EnetServer::new();
        let now = Instant::now();
        let mut events = Vec::new();
        server
            .handle_datagram(
                "127.0.0.1:6000".parse().unwrap(),
                &connect_datagram(0xFF, 0xFF, 7, 0),
                now,
                &mut events,
            )
            .unwrap();
        let datagrams = server.flush(now);
        server
            .handle_datagram(
                "127.0.0.1:6000".parse().unwrap(),
                &ack_of_verify(&datagrams[0]),
                now,
                &mut events,
            )
            .unwrap();
        events.clear();

        let send = |channel: u8, seq: u16, payload: &[u8]| {
            let mut packet = Vec::new();
            packet.extend_from_slice(&0x8000u16.to_be_bytes()); // session 0 + sent time
            packet.extend_from_slice(&0x1111u16.to_be_bytes());
            packet.push(COMMAND_SEND_RELIABLE | FLAG_ACKNOWLEDGE);
            packet.push(channel);
            packet.extend_from_slice(&seq.to_be_bytes());
            packet.extend_from_slice(&(payload.len() as u16).to_be_bytes());
            packet.extend_from_slice(payload);
            packet
        };
        let from = "127.0.0.1:6000".parse().unwrap();

        // out of order: 2 arrives first, then 1
        server
            .handle_datagram(from, &send(0, 2, b"second"), now, &mut events)
            .unwrap();
        assert!(events.is_empty());
        server
            .handle_datagram(from, &send(0, 1, b"first"), now, &mut events)
            .unwrap();
        let payloads: Vec<&[u8]> = events
            .iter()
            .map(|event| match event {
                EnetEvent::Payload { payload, .. } => payload.as_slice(),
                _ => panic!("unexpected event"),
            })
            .collect();
        assert_eq!(payloads, [b"first".as_slice(), b"second".as_slice()]);

        // duplicate delivery is absorbed
        events.clear();
        server
            .handle_datagram(from, &send(0, 2, b"second"), now, &mut events)
            .unwrap();
        assert!(events.is_empty());

        // every reliable command is ACKed; ACKs ride in the next flush
        let datagrams = server.flush(now + Duration::from_millis(1));
        let ack_count = datagrams[0][4..]
            .chunks(8)
            .filter(|chunk| !chunk.is_empty() && chunk[0] == COMMAND_ACKNOWLEDGE)
            .count();
        assert!(ack_count >= 3);
    }

    /// The exact datagram shape that stalled the live stream: the client's
    /// pure-ACK packet carries NO FLAG_SENT_TIME, so its commands start at
    /// offset 2. Parsed with a fixed offset of 4 the first command byte
    /// reads as the (invalid) kind 0 and the whole datagram is discarded.
    #[test]
    fn flagless_pure_ack_datagram_parses() {
        let mut server = EnetServer::new();
        let now = Instant::now();
        let mut events = Vec::new();
        server
            .handle_datagram(
                "127.0.0.1:6000".parse().unwrap(),
                &connect_datagram(0xFF, 0xFF, 7, 0),
                now,
                &mut events,
            )
            .unwrap();
        let datagrams = server.flush(now);
        server
            .handle_datagram(
                "127.0.0.1:6000".parse().unwrap(),
                &ack_of_verify(&datagrams[0]),
                now,
                &mut events,
            )
            .unwrap();

        // captured live from Moonlight: ACKNOWLEDGE ch0xFF seq1,
        // receivedReliableSeq=1, receivedSentTime=0xe4e0 — no sentTime field
        let flagless_ack = [
            0x00, 0x00, // header: peer 0, session 0, no FLAG_SENT_TIME
            0x01, 0xff, 0x00, 0x01, // ACKNOWLEDGE, channel 0xFF, seq 1
            0x00, 0x01, 0xe4, 0xe0, // body: received seq 1, sentTime 0xe4e0
        ];
        server
            .handle_datagram(
                "127.0.0.1:6000".parse().unwrap(),
                &flagless_ack,
                now,
                &mut events,
            )
            .unwrap();
        assert_eq!(server.stats.acknowledge, 2); // handshake ACK + flagless ACK
        assert_eq!(server.stats.malformed, 0);
    }

    /// Reproduces the ~35s live stall: twenty flagless SEND_RELIABLE
    /// datagrams (the client's later control messages) must each advance
    /// last-acked; the offset-4 bug dropped them all un-acked.
    #[test]
    fn flagless_reliable_datagrams_are_acked_without_stall() {
        let mut server = EnetServer::new();
        let now = Instant::now();
        let mut events = Vec::new();
        server
            .handle_datagram(
                "127.0.0.1:6000".parse().unwrap(),
                &connect_datagram(0xFF, 0xFF, 7, 0),
                now,
                &mut events,
            )
            .unwrap();
        let datagrams = server.flush(now);
        server
            .handle_datagram(
                "127.0.0.1:6000".parse().unwrap(),
                &ack_of_verify(&datagrams[0]),
                now,
                &mut events,
            )
            .unwrap();
        events.clear();

        let from = "127.0.0.1:6000".parse().unwrap();
        for seq in 1..=20u16 {
            let mut packet = Vec::new();
            packet.extend_from_slice(&0x0000u16.to_be_bytes()); // no FLAG_SENT_TIME
            packet.push(COMMAND_SEND_RELIABLE | FLAG_ACKNOWLEDGE);
            packet.push(0);
            packet.extend_from_slice(&seq.to_be_bytes());
            packet.extend_from_slice(&4u16.to_be_bytes()); // payload length
            packet.extend_from_slice(&[0xDE, 0xAD, 0xBE, 0xEF]);
            server
                .handle_datagram(from, &packet, now, &mut events)
                .unwrap();
        }
        assert_eq!(server.stats.send_reliable, 20);
        assert_eq!(server.stats.malformed, 0);
        assert_eq!(server.stats.duplicate_reliable, 0);
        assert_eq!(server.stats.last_acked_incoming.get(&0), Some(&20));
        // every one of them queued an ACK and flush serializes all of them
        let flushed = server.flush(now);
        assert_eq!(server.stats.acks_sent, 1 + 20); // CONNECT ack + 20 reliable ACKs
        assert!(flushed.iter().any(|d| d.windows(8).any(|w| w[0] == COMMAND_ACKNOWLEDGE)));
    }

    /// Liveness: a datagram that fails parsing must not refresh
    /// last_receive (the session survived 90s+ of stalled ENet because
    /// malformed retransmits kept feeding the silence timer).
    #[test]
    fn malformed_datagram_does_not_feed_liveness() {
        let mut server = EnetServer::new();
        let now = Instant::now();
        let mut events = Vec::new();
        server
            .handle_datagram(
                "127.0.0.1:6000".parse().unwrap(),
                &connect_datagram(0xFF, 0xFF, 7, 0),
                now,
                &mut events,
            )
            .unwrap();
        let datagrams = server.flush(now);
        server
            .handle_datagram(
                "127.0.0.1:6000".parse().unwrap(),
                &ack_of_verify(&datagrams[0]),
                now,
                &mut events,
            )
            .unwrap();

        // valid traffic at t0 + 5s keeps the peer alive
        let later = now + Duration::from_secs(5);
        let good = ack_of_verify(&datagrams[0]);
        server
            .handle_datagram("127.0.0.1:6000".parse().unwrap(), &good, later, &mut events)
            .unwrap();
        assert!(server.silent_for(later).unwrap() < Duration::from_millis(1));

        // garbage 7s later is rejected and must NOT reset the clock
        let garbage_time = now + Duration::from_secs(7);
        let garbage = [0x00u8, 0x00, 0xFF, 0xFF, 0x02, 0x03];
        let result = server.handle_datagram(
            "127.0.0.1:6000".parse().unwrap(),
            &garbage,
            garbage_time,
            &mut events,
        );
        assert!(result.is_err());
        assert_eq!(
            server.silent_for(garbage_time).unwrap(),
            Duration::from_secs(2), // still measured from the last GOOD datagram
        );
    }

    fn connected_server() -> (EnetServer, Instant) {
        connected_server_with_channels(4)
    }

    fn connected_server_with_channels(channels: u32) -> (EnetServer, Instant) {
        let mut server = EnetServer::new();
        let now = Instant::now();
        let mut events = Vec::new();
        server
            .handle_datagram(
                "127.0.0.1:6000".parse().unwrap(),
                &connect_datagram_with_channels(0xFF, 0xFF, 7, 0, channels),
                now,
                &mut events,
            )
            .unwrap();
        let datagrams = server.flush(now);
        server
            .handle_datagram(
                "127.0.0.1:6000".parse().unwrap(),
                &ack_of_verify(&datagrams[0]),
                now,
                &mut events,
            )
            .unwrap();
        (server, now)
    }

    /// The exact live capture that regressed the stream: a flagless ENet
    /// datagram whose only command is SEND_UNSEQUENCED carrying a 49-byte
    /// 0x0001 AES-GCM envelope (encrypted input). The old parser treated
    /// it as an unknown command and discarded the whole datagram.
    fn captured_unsequenced_input(ack_tail: &[u8]) -> Vec<u8> {
        let mut payload = vec![0x01, 0x00, 0x2d, 0x00, 0x08, 0x00, 0x00, 0x00];
        payload.extend((0..41u8).map(|b| 0x97u8.wrapping_add(b * 7)));
        assert_eq!(payload.len(), 49);
        let mut packet = vec![0x00, 0x00]; // header: peer 0, no sent time
        packet.extend_from_slice(&[0x49, 0x00, 0x00, 0x00]); // SEND_UNSEQUENCED ch0
        packet.extend_from_slice(&[0x00, 0x01, 0x00, 0x31]); // group 1, length 49
        packet.extend_from_slice(&payload);
        packet.extend_from_slice(ack_tail);
        packet
    }

    #[test]
    fn captured_unsequenced_input_datagram_parses() {
        let (mut server, now) = connected_server();
        let mut events = Vec::new();
        let packet = captured_unsequenced_input(&[]);
        assert_eq!(packet.len(), 59);
        server
            .handle_datagram("127.0.0.1:6000".parse().unwrap(), &packet, now, &mut events)
            .unwrap();
        assert_eq!(server.stats.send_unsequenced, 1);
        assert_eq!(server.stats.malformed, 0);
        let payloads: Vec<&[u8]> = events
            .iter()
            .map(|event| match event {
                EnetEvent::Payload { payload, .. } => payload.as_slice(),
                _ => panic!("unexpected event"),
            })
            .collect();
        assert_eq!(payloads.len(), 1);
        assert_eq!(payloads[0].len(), 49);
        assert_eq!(
            &payloads[0][..8],
            &[0x01, 0x00, 0x2d, 0x00, 0x08, 0x00, 0x00, 0x00],
            "0x0001 encrypted control envelope"
        );
    }

    #[test]
    fn unsequenced_payload_and_co_packed_ack_both_process() {
        // regression for the whole-datagram drop: a datagram containing
        // [SEND_UNSEQUENCED][ACKNOWLEDGE] must deliver the payload AND
        // process the ACK
        let (mut server, now) = connected_server();
        let ack_tail = [
            0x01, 0x00, 0x00, 0x05, // ACKNOWLEDGE ch0 seq5
            0x00, 0x05, 0x12, 0x34, // body: received seq 5, sentTime
        ];
        let packet = captured_unsequenced_input(&ack_tail);
        let mut events = Vec::new();
        server
            .handle_datagram("127.0.0.1:6000".parse().unwrap(), &packet, now, &mut events)
            .unwrap();
        assert_eq!(server.stats.send_unsequenced, 1);
        assert_eq!(server.stats.acknowledge, 2); // handshake ACK + this one
        assert_eq!(
            events
                .iter()
                .filter(|event| matches!(event, EnetEvent::Payload { .. }))
                .count(),
            1
        );
        assert_eq!(server.stats.malformed, 0);
    }

    /// One SEND_FRAGMENT command (cgutman/enet protocol.h
    /// ENetProtocolSendFragment): {cmd hdr} {startSeq u16, dataLength u16,
    /// fragmentCount u32, fragmentNumber u32, totalLength u32,
    /// fragmentOffset u32} {data}. The command header's reliable sequence
    /// number is the FRAGMENT's own — one per fragment, consecutive from
    /// startSequenceNumber, which is what the client's sender assigns
    /// (peer.c enet_peer_send_fragments + enet_peer_setup_outgoing_command)
    /// and what its per-fragment ACK bookkeeping expects.
    fn fragment_command(
        start: u16,
        count: u32,
        number: u32,
        total: u32,
        offset: u32,
        data: &[u8],
    ) -> Vec<u8> {
        let mut packet = Vec::new();
        packet.extend_from_slice(&0x8000u16.to_be_bytes()); // session 0 + sent time
        packet.extend_from_slice(&0x1234u16.to_be_bytes());
        packet.push(COMMAND_SEND_FRAGMENT | FLAG_ACKNOWLEDGE);
        packet.push(0);
        packet.extend_from_slice(&start.wrapping_add(number as u16).to_be_bytes());
        packet.extend_from_slice(&start.to_be_bytes());
        packet.extend_from_slice(&(data.len() as u16).to_be_bytes());
        packet.extend_from_slice(&count.to_be_bytes());
        packet.extend_from_slice(&number.to_be_bytes());
        packet.extend_from_slice(&total.to_be_bytes());
        packet.extend_from_slice(&offset.to_be_bytes());
        packet.extend_from_slice(data);
        packet
    }

    fn delivered_payloads(events: &[EnetEvent]) -> Vec<Vec<u8>> {
        events
            .iter()
            .filter_map(|event| match event {
                EnetEvent::Payload { payload, .. } => Some(payload.clone()),
                _ => None,
            })
            .collect()
    }

    /// (channel, reliable sequence) of every ACKNOWLEDGE `flush` serialized
    /// (serialize_datagram writes them first, after the 4-byte header).
    fn acked_commands(datagrams: &[Vec<u8>]) -> Vec<(u8, u16)> {
        let mut acks = Vec::new();
        for datagram in datagrams {
            let mut offset = 4;
            while offset + 8 <= datagram.len() && datagram[offset] & COMMAND_MASK == COMMAND_ACKNOWLEDGE
            {
                acks.push((
                    datagram[offset + 1],
                    u16::from_be_bytes(datagram[offset + 2..offset + 4].try_into().unwrap()),
                ));
                offset += 8;
            }
        }
        acks
    }

    /// The defect this test used to assert: a SEND_FRAGMENT payload was
    /// sized, ACKed when the ACKNOWLEDGE flag was set, then skipped — so
    /// every message the client had to fragment (anything above its
    /// negotiated MTU, 900 in its CONNECT) was acknowledged and thrown
    /// away, and the client never retransmitted it because it believed it
    /// had been delivered. The fragment now reaches the reassembler, and
    /// the rest of its datagram (here a co-packed ACKNOWLEDGE) still
    /// parses.
    #[test]
    fn fragment_commands_reach_the_reassembler_without_dropping_the_datagram() {
        let (mut server, now) = connected_server();
        // {cmd hdr} {startSeq u16, dataLength u16, fragmentCount u32,
        // fragmentNumber u32, totalLength u32, fragmentOffset u32} {data}
        let mut packet = vec![0x00, 0x00];
        packet.extend_from_slice(&[0x88, 0x00, 0x00, 0x01]); // SEND_FRAGMENT|ACK ch0 seq1
        packet.extend_from_slice(&[0x00, 0x01, 0x00, 0x04]); // startSeq 1, dataLength 4
        packet.extend_from_slice(&[0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 8, 0, 0, 0, 0]); // count/num/total/offset
        packet.extend_from_slice(&[1, 2, 3, 4]); // fragment data
        packet.extend_from_slice(&[
            0x01, 0x00, 0x00, 0x05, 0x00, 0x05, 0x12, 0x34, // ACKNOWLEDGE
        ]);
        let mut events = Vec::new();
        server
            .handle_datagram("127.0.0.1:6000".parse().unwrap(), &packet, now, &mut events)
            .unwrap();
        assert_eq!(server.stats.send_fragment, 1);
        assert_eq!(server.stats.acknowledge, 2);
        assert_eq!(server.stats.malformed, 0);
        // the fragment was reassembled, not skipped: half a message is not
        // a message, so nothing is delivered yet
        assert!(events.is_empty());
        assert_eq!(server.stats.fragment_drops, 0);
        assert_eq!(server.stats.window_discards, 0);
        assert_eq!(server.stats.next_expected.get(&0), None);
        assert_eq!(
            acked_commands(&server.flush(now)),
            vec![(0, 1)],
            "the fragment is ACKed on receipt (the co-packed ACK went out too)"
        );
    }

    /// A message the client had to fragment is delivered to the
    /// application layer as ONE payload once its last fragment lands, and
    /// it advances the delivery cursor past every fragment's sequence
    /// number.
    #[test]
    fn fragmented_message_is_reassembled_and_delivered_in_order() {
        let (mut server, now) = connected_server();
        let from: SocketAddr = "127.0.0.1:6000".parse().unwrap();
        let mut events = Vec::new();
        server
            .handle_datagram(from, &fragment_command(1, 2, 0, 8, 0, b"abcd"), now, &mut events)
            .unwrap();
        assert!(events.is_empty(), "the first fragment alone is not a message");
        server
            .handle_datagram(from, &fragment_command(1, 2, 1, 8, 4, b"efgh"), now, &mut events)
            .unwrap();
        assert_eq!(delivered_payloads(&events), vec![b"abcdefgh".to_vec()]);
        assert_eq!(server.stats.send_fragment, 2);
        assert_eq!(server.stats.fragment_messages, 1);
        assert_eq!(server.stats.fragment_drops, 0);
        assert_eq!(server.stats.window_discards, 0);
        assert_eq!(server.stats.duplicate_reliable, 0);
        // both fragments' sequence numbers are consumed by the message
        assert_eq!(server.stats.next_expected.get(&0), Some(&2));
        // ACKed on receipt, one ACK per fragment
        assert_eq!(server.stats.last_acked_incoming.get(&0), Some(&2));
        assert_eq!(acked_commands(&server.flush(now)), vec![(0, 1), (0, 2)]);
    }

    #[test]
    fn fragments_arriving_out_of_order_still_deliver_in_order() {
        let (mut server, now) = connected_server();
        let from: SocketAddr = "127.0.0.1:6000".parse().unwrap();
        let mut events = Vec::new();
        server
            .handle_datagram(from, &fragment_command(1, 2, 1, 8, 4, b"efgh"), now, &mut events)
            .unwrap();
        assert!(events.is_empty(), "the tail without the head");
        server
            .handle_datagram(from, &fragment_command(1, 2, 0, 8, 0, b"abcd"), now, &mut events)
            .unwrap();
        assert_eq!(delivered_payloads(&events), vec![b"abcdefgh".to_vec()]);
        assert_eq!(server.stats.fragment_messages, 1);
        assert_eq!(server.stats.next_expected.get(&0), Some(&2));
        assert_eq!(server.stats.window_discards, 0);
    }

    /// A retransmitted fragment (our ACK was lost) must be idempotent:
    /// it is ACKed again, it never decrements the missing-fragment count
    /// twice (which would deliver a half-zeroed message on the next
    /// arrival), and after the message has been delivered the retransmit
    /// is ignored outright.
    #[test]
    fn duplicate_fragments_are_ignored() {
        let (mut server, now) = connected_server();
        let from: SocketAddr = "127.0.0.1:6000".parse().unwrap();
        let mut events = Vec::new();
        server
            .handle_datagram(from, &fragment_command(1, 2, 0, 8, 0, b"abcd"), now, &mut events)
            .unwrap();
        server
            .handle_datagram(from, &fragment_command(1, 2, 0, 8, 0, b"abcd"), now, &mut events)
            .unwrap();
        assert!(
            events.is_empty(),
            "a duplicate must not complete the message on its own"
        );
        server
            .handle_datagram(from, &fragment_command(1, 2, 1, 8, 4, b"efgh"), now, &mut events)
            .unwrap();
        assert_eq!(delivered_payloads(&events), vec![b"abcdefgh".to_vec()]);
        events.clear();
        // the message is delivered: its whole sequence range is at/below
        // the cursor now, so a retransmit of either fragment is ignored
        // (and ACKed — the client only re-sends what it never saw ACKed)
        server
            .handle_datagram(from, &fragment_command(1, 2, 0, 8, 0, b"abcd"), now, &mut events)
            .unwrap();
        assert!(events.is_empty(), "nothing is delivered twice");
        assert_eq!(server.stats.fragment_messages, 1);
        assert_eq!(server.stats.fragment_drops, 0);
        assert_eq!(server.stats.window_discards, 0);
        assert_eq!(server.stats.last_acked_incoming.get(&0), Some(&2));
    }

    /// An incomplete message holds the cursor at its start - 1: nothing
    /// may overtake it, and it delivers (followed by what was waiting
    /// behind it) exactly when its last fragment arrives.
    #[test]
    fn incomplete_fragmented_message_is_never_delivered() {
        let (mut server, now) = connected_server();
        let from: SocketAddr = "127.0.0.1:6000".parse().unwrap();
        let mut events = Vec::new();
        // a 3-fragment message occupying sequences 1..=3, first fragment only
        server
            .handle_datagram(from, &fragment_command(1, 3, 0, 12, 0, b"abcd"), now, &mut events)
            .unwrap();
        assert!(events.is_empty());
        // a reliable just past the message's range arrives: it buffers, it
        // must not be delivered ahead of the message
        let mut reliable = Vec::new();
        reliable.extend_from_slice(&0x0000u16.to_be_bytes());
        reliable.push(COMMAND_SEND_RELIABLE | FLAG_ACKNOWLEDGE);
        reliable.push(0);
        reliable.extend_from_slice(&4u16.to_be_bytes());
        reliable.extend_from_slice(&2u16.to_be_bytes());
        reliable.extend_from_slice(b"hi");
        server.handle_datagram(from, &reliable, now, &mut events).unwrap();
        assert!(events.is_empty(), "nothing overtakes an incomplete message");
        assert_eq!(server.stats.next_expected.get(&0), None);
        assert_eq!(server.stats.window_discards, 0);
        // the missing fragments complete it: message first, buffered
        // reliable second — in order
        server
            .handle_datagram(from, &fragment_command(1, 3, 1, 12, 4, b"efgh"), now, &mut events)
            .unwrap();
        assert!(events.is_empty());
        server
            .handle_datagram(from, &fragment_command(1, 3, 2, 12, 8, b"ijkl"), now, &mut events)
            .unwrap();
        assert_eq!(
            delivered_payloads(&events),
            vec![b"abcdefghijkl".to_vec(), b"hi".to_vec()]
        );
        assert_eq!(server.stats.fragment_messages, 1);
        assert_eq!(server.stats.next_expected.get(&0), Some(&4));
    }

    /// The ACK policy for fragments is the one this codebase already uses
    /// for reliables — ACK at RECEIPT (the client's send window is freed
    /// per fragment), which is exactly why the message must be reassembled
    /// rather than skipped — and a message that is complete but still out
    /// of order waits for the cursor without being counted as a discard.
    #[test]
    fn fragment_acks_track_receipt_without_window_discards() {
        let (mut server, now) = connected_server();
        let from: SocketAddr = "127.0.0.1:6000".parse().unwrap();
        let mut events = Vec::new();
        for number in 0..2u32 {
            server
                .handle_datagram(
                    from,
                    &fragment_command(5, 2, number, 8, number as u32 * 4, if number == 0 { b"abcd" } else { b"efgh" }),
                    now,
                    &mut events,
                )
                .unwrap();
        }
        assert!(
            events.is_empty(),
            "complete, but sequences 1..=4 have not been delivered"
        );
        assert_eq!(server.stats.last_acked_incoming.get(&0), Some(&6));
        assert_eq!(server.stats.next_expected.get(&0), None);
        assert_eq!(server.stats.window_discards, 0);
        assert_eq!(server.stats.duplicate_reliable, 0);
        assert_eq!(server.stats.fragment_drops, 0);
        // the gap fills: the message delivers where its first sequence
        // number sits in the stream
        for seq in 1..=4u16 {
            let mut packet = Vec::new();
            packet.extend_from_slice(&0x0000u16.to_be_bytes());
            packet.push(COMMAND_SEND_RELIABLE | FLAG_ACKNOWLEDGE);
            packet.push(0);
            packet.extend_from_slice(&seq.to_be_bytes());
            packet.extend_from_slice(&0u16.to_be_bytes());
            server.handle_datagram(from, &packet, now, &mut events).unwrap();
        }
        assert_eq!(
            delivered_payloads(&events),
            vec![
                Vec::new(),
                Vec::new(),
                Vec::new(),
                Vec::new(),
                b"abcdefgh".to_vec()
            ]
        );
        assert_eq!(server.stats.next_expected.get(&0), Some(&6));
        assert_eq!(server.stats.fragment_messages, 1);
    }

    /// Reassembly state is bounded: a peer that opens partial messages
    /// without ever completing them is refused (and counted) once the
    /// per-channel cap is reached, and a refused fragment is NOT ACKed so
    /// the client keeps retransmitting it instead of the channel wedging
    /// behind a message that can never complete.
    #[test]
    fn partial_messages_per_channel_are_capped() {
        let (mut server, now) = connected_server();
        let from: SocketAddr = "127.0.0.1:6000".parse().unwrap();
        let mut events = Vec::new();
        for start in [1u16, 10, 20, 30, 40] {
            server
                .handle_datagram(from, &fragment_command(start, 2, 0, 8, 0, b"abcd"), now, &mut events)
                .unwrap();
        }
        assert_eq!(server.stats.send_fragment, 5);
        assert_eq!(server.stats.fragment_drops, 1, "the fifth is over the cap");
        assert_eq!(
            server.stats.last_acked_incoming.get(&0),
            Some(&30),
            "the refused fragment is not ACKed (seq 40)"
        );
        assert_eq!(server.stats.window_discards, 0);
        // the four it did accept are intact: one of them still completes
        server
            .handle_datagram(from, &fragment_command(1, 2, 1, 8, 4, b"efgh"), now, &mut events)
            .unwrap();
        assert_eq!(delivered_payloads(&events), vec![b"abcdefgh".to_vec()]);
        assert_eq!(server.stats.fragment_messages, 1);
    }

    /// The two field bounds that keep a single small fragment from
    /// claiming a huge buffer: fragmentCount above the receipt-bitmap cap
    /// and a totalLength above the peer's reassembly budget are refused
    /// without allocating, counted, and not ACKed.
    #[test]
    fn fragment_count_and_total_length_are_capped() {
        let (mut server, now) = connected_server();
        let from: SocketAddr = "127.0.0.1:6000".parse().unwrap();
        let mut events = Vec::new();
        server
            .handle_datagram(
                from,
                &fragment_command(1, MAX_FRAGMENT_COUNT + 1, 0, 8, 0, b"abcd"),
                now,
                &mut events,
            )
            .unwrap();
        server
            .handle_datagram(
                from,
                &fragment_command(
                    3,
                    2,
                    0,
                    (MAX_PARTIAL_FRAGMENT_BYTES + 1) as u32,
                    0,
                    b"abcd",
                ),
                now,
                &mut events,
            )
            .unwrap();
        assert_eq!(server.stats.send_fragment, 2);
        assert_eq!(server.stats.fragment_drops, 2);
        assert!(events.is_empty());
        // a fragment on a channel the CONNECT never opened has nowhere to
        // be reassembled either: refused, counted, not ACKed
        let mut unknown_channel = fragment_command(9, 2, 0, 8, 0, b"abcd");
        unknown_channel[5] = 5;
        server
            .handle_datagram(from, &unknown_channel, now, &mut events)
            .unwrap();
        assert_eq!(server.stats.send_fragment, 3);
        assert_eq!(server.stats.fragment_drops, 3);
        assert!(events.is_empty());
        assert_eq!(
            server.stats.last_acked_incoming.get(&0),
            None,
            "neither refused fragment is ACKed"
        );
        assert_eq!(server.stats.last_acked_incoming.get(&5), None);
        assert!(acked_commands(&server.flush(now)).is_empty());
        assert_eq!(server.stats.window_discards, 0);
    }

    /// Reference duplicate-peer behavior (protocol.c handle_connect): a
    /// fresh CONNECT from the same address with a NEW connectID resets
    /// the old peer and completes a new handshake instead of being
    /// rejected while the old slot is busy.
    #[test]
    fn reconnect_with_new_connect_id_resets_the_peer() {
        let (mut server, now) = connected_server();
        let from = "127.0.0.1:6000".parse().unwrap();
        // same address, different connect id -> reset + new handshake
        server
            .handle_datagram(from, &connect_datagram(0xFF, 0xFF, 99, 0x1234), now, &mut Vec::new())
            .unwrap();
        assert!(server.peer_connected() || server.peer_address().is_some());
        // the new handshake must complete independently
        let datagrams = server.flush(now);
        let mut events = Vec::new();
        server
            .handle_datagram(from, &ack_of_verify(&datagrams[0]), now, &mut events)
            .unwrap();
        assert!(matches!(
            events.as_slice(),
            [EnetEvent::Connected { .. }]
        ));
        assert_eq!(server.stats.connect, 2);
    }

    /// The live stall shape: seqs 1..=99 delivered, 100 lost, 101..=302
    /// arrive out of order. ACKs must track RECEIPT (302) not delivery,
    /// nothing buffered may be silently dropped, and the late 100 must
    /// drain the whole reorder buffer in order.
    #[test]
    fn acks_track_receipt_even_when_delivery_stalls() {
        let (mut server, now) = connected_server();
        let from = "127.0.0.1:6000".parse().unwrap();
        let send = |seq: u16| {
            let mut packet = Vec::new();
            packet.extend_from_slice(&0x0000u16.to_be_bytes());
            packet.push(COMMAND_SEND_RELIABLE | FLAG_ACKNOWLEDGE);
            packet.push(0);
            packet.extend_from_slice(&seq.to_be_bytes());
            packet.extend_from_slice(&2u16.to_be_bytes());
            packet.extend_from_slice(b"hi");
            packet
        };

        for seq in 1..=99u16 {
            let mut events = Vec::new();
            server.handle_datagram(from, &send(seq), now, &mut events).unwrap();
            assert_eq!(events.len(), 1, "seq {seq} delivered in order");
        }
        // the gap: 100 is lost on the wire; 101..=302 arrive out of order
        for seq in 101..=302u16 {
            let mut events = Vec::new();
            server.handle_datagram(from, &send(seq), now, &mut events).unwrap();
            assert!(
                events.is_empty(),
                "seq {seq} must buffer, not deliver, before the gap fills"
            );
        }
        // ACKs advanced on receipt, independent of delivery
        assert_eq!(server.stats.last_acked_incoming.get(&0), Some(&302));
        assert_eq!(server.stats.duplicate_reliable, 0);
        // sending the lost 100 delivers it AND drains 101..=302 in order
        let mut events = Vec::new();
        server.handle_datagram(from, &send(100), now, &mut events).unwrap();
        assert_eq!(
            events.len(),
            203,
            "late gap filler drains the reorder buffer in order"
        );
        // and retransmitting an already-delivered seq is discarded by the
        // receive window (like the reference), not delivered twice
        let mut events = Vec::new();
        server.handle_datagram(from, &send(100), now, &mut events).unwrap();
        assert!(events.is_empty());
        assert_eq!(server.stats.duplicate_reliable, 0);
        assert_eq!(server.stats.window_discards, 1);
    }

    /// THE invariant: an acked reliable must never be dropped before
    /// delivery. Live shape: 1..=25 delivered, 26 lost, 27..=192 arrive
    /// out of order while the client retransmits already-delivered seqs;
    /// when the gap filler finally arrives, everything up to 192 must
    /// deliver exactly once, and the receive window may only discard
    /// already-delivered seqs.
    #[test]
    fn acked_reliables_are_never_dropped_before_delivery() {
        let (mut server, now) = connected_server();
        let from = "127.0.0.1:6000".parse().unwrap();
        let send = |seq: u16| {
            let mut packet = Vec::new();
            packet.extend_from_slice(&0x0000u16.to_be_bytes());
            packet.push(COMMAND_SEND_RELIABLE | FLAG_ACKNOWLEDGE);
            packet.push(0);
            packet.extend_from_slice(&seq.to_be_bytes());
            packet.extend_from_slice(&2u16.to_be_bytes());
            packet.extend_from_slice(&seq.to_le_bytes()); // payload = seq
            packet
        };
        let mut delivered: Vec<u16> = Vec::new();
        let drive = |server: &mut EnetServer, seq: u16, delivered: &mut Vec<u16>| {
            let mut events = Vec::new();
            server.handle_datagram(from, &send(seq), now, &mut events).unwrap();
            for event in events {
                if let EnetEvent::Payload { payload, .. } = event {
                    delivered.push(u16::from_le_bytes(payload.try_into().unwrap()));
                }
            }
        };

        for seq in 1..=25u16 {
            drive(&mut server, seq, &mut delivered);
        }
        // 26 is lost on the wire; 27..=192 arrive out of order
        for seq in 27..=192u16 {
            let before = delivered.len();
            drive(&mut server, seq, &mut delivered);
            assert_eq!(delivered.len(), before, "seq {seq} must buffer");
        }
        assert_eq!(server.stats.last_acked_incoming.get(&0), Some(&192));
        assert_eq!(server.stats.next_expected.get(&0), Some(&25));

        // the client retransmits: already-delivered 1..=10 (window may
        // discard these — they ARE delivered) and the gap filler 26,
        // which must NEVER be discarded
        for round in 0..3 {
            for seq in 1..=10u16 {
                drive(&mut server, seq, &mut delivered);
            }
            let before = delivered.len();
            drive(&mut server, 26, &mut delivered);
            if round == 0 {
                assert_eq!(
                    delivered.len(),
                    before + 167, // 26 itself + 27..=192 (166) drained in order
                    "gap filler must deliver and drain the buffer"
                );
            }
        }

        // invariant: every seq delivered exactly once, in order
        let expected: Vec<u16> = (1..=192).collect();
        assert_eq!(delivered, expected);
        assert_eq!(server.stats.next_expected.get(&0), Some(&192));
        assert_eq!(server.stats.last_acked_incoming.get(&0), Some(&192));
        // window discards happened only for already-delivered seqs:
        // 3 rounds x retransmits of 1..=10, plus the late 26 x2 — and all
        // of them the behind-cursor rule, which is what the per-channel
        // split exists to show (the 5s stats line's behind/ahead counts)
        assert_eq!(server.stats.window_discards, 32);
        assert_eq!(server.stats.discards_by_channel.get(&0), Some(&(32, 0)));
    }

    /// EXACT live wedge numbers (last-acked=106, next-expected=6): 1..=6
    /// delivered, 7 never arrives while 8..=106 buffer, then the gap
    /// filler 7 finally arrives. With the watermark at 6, seq 7 is the
    /// EXPECTED sequence: both this code and the ENet reference deliver
    /// it and drain the buffer to 106. Window drops at this watermark
    /// are impossible for seq 7 — only already-delivered seqs can drop.
    #[test]
    fn live_wedge_shape_gap_filler_delivers_and_drains() {
        let (mut server, now) = connected_server();
        let from = "127.0.0.1:6000".parse().unwrap();
        let send = |seq: u16| {
            let mut packet = Vec::new();
            packet.extend_from_slice(&0x0000u16.to_be_bytes());
            packet.push(COMMAND_SEND_RELIABLE | FLAG_ACKNOWLEDGE);
            packet.push(0);
            packet.extend_from_slice(&seq.to_be_bytes());
            packet.extend_from_slice(&2u16.to_be_bytes());
            packet.extend_from_slice(&seq.to_le_bytes());
            packet
        };
        let mut delivered = Vec::new();
        let drive = |server: &mut EnetServer, seq: u16, delivered: &mut Vec<u16>| {
            let mut events = Vec::new();
            server.handle_datagram(from, &send(seq), now, &mut events).unwrap();
            for event in events {
                if let EnetEvent::Payload { payload, .. } = event {
                    delivered.push(u16::from_le_bytes(payload.try_into().unwrap()));
                }
            }
        };

        for seq in 1..=6u16 {
            drive(&mut server, seq, &mut delivered);
        }
        // 7 is lost on the wire; 8..=106 arrive out of order and buffer
        for seq in 8..=106u16 {
            let before = delivered.len();
            drive(&mut server, seq, &mut delivered);
            assert_eq!(delivered.len(), before, "seq {seq} must buffer");
        }
        assert_eq!(server.stats.last_acked_incoming.get(&0), Some(&106));
        assert_eq!(server.stats.next_expected.get(&0), Some(&6));
        assert_eq!(server.reorder_depths().get(&0), Some(&99));
        // the gap filler finally arrives: it is the EXPECTED sequence
        // (watermark 6), so it must deliver and drain — never drop
        drive(&mut server, 7, &mut delivered);
        assert_eq!(delivered, (1..=106).collect::<Vec<u16>>());
        assert_eq!(server.stats.next_expected.get(&0), Some(&106));
        assert_eq!(server.stats.window_discards, 0);
        assert_eq!(server.reorder_depths().get(&0), None);
    }

    /// THE live input-channel wedge, replayed and then pushed past the
    /// old rule's tolerance. Input is reliable sequenced on ch16
    /// (moonlight-common-c: CTRL_CHANNEL_GAMEPAD_BASE = 0x10, every
    /// keyboard/mouse/gamepad event ENET_PACKET_FLAG_RELIABLE), our ACKs
    /// free the client's send window on every receipt, so its per-channel
    /// counter can run arbitrarily far ahead of our delivery cursor while
    /// an early sequence's retransmits keep getting lost.
    ///
    /// Phase 1 replays the trace numbers: 1..=172 delivered, 173 lost,
    /// 174..=3812 stream in (watermark 3812, next-expected 172). Phase 2
    /// pushes the same shape past FREE - 1 windows ahead of the cursor
    /// (3813 lost while 3814..=32000 stream in) — the old rule ACKed and
    /// discarded those, permanently wedging the channel. Invariant: an
    /// ACKed sequence is buffered or delivered, and once the lost gap
    /// fillers arrive everything drains in order exactly once.
    #[test]
    fn input_channel_runs_ahead_of_delivery_without_losing_acked_messages() {
        let (mut server, now) = connected_server_with_channels(0x30);
        let from = "127.0.0.1:6000".parse().unwrap();
        const CH: u8 = 16; // CTRL_CHANNEL_GAMEPAD_BASE
        let send = |seq: u16| {
            let mut packet = Vec::new();
            packet.extend_from_slice(&0x0000u16.to_be_bytes());
            packet.push(COMMAND_SEND_RELIABLE | FLAG_ACKNOWLEDGE);
            packet.push(CH);
            packet.extend_from_slice(&seq.to_be_bytes());
            packet.extend_from_slice(&2u16.to_be_bytes());
            packet.extend_from_slice(&seq.to_le_bytes()); // payload = seq
            packet
        };
        let mut delivered: Vec<u16> = Vec::new();
        let drive = |server: &mut EnetServer, seq: u16, delivered: &mut Vec<u16>| {
            let mut events = Vec::new();
            server.handle_datagram(from, &send(seq), now, &mut events).unwrap();
            for event in events {
                if let EnetEvent::Payload { payload, .. } = event {
                    delivered.push(u16::from_le_bytes(payload.try_into().unwrap()));
                }
            }
        };

        // Phase 1: the exact trace. 173's retransmits stay lost.
        for seq in 1..=172u16 {
            drive(&mut server, seq, &mut delivered);
        }
        for seq in 174..=3812u16 {
            let before = delivered.len();
            drive(&mut server, seq, &mut delivered);
            assert_eq!(delivered.len(), before, "seq {seq} must buffer");
        }
        // client retransmits already-delivered seqs (its ACKs back are
        // starved): discarded as already delivered, but still ACKed
        for seq in 1..=10u16 {
            drive(&mut server, seq, &mut delivered);
        }
        // the trace's stats line, mid-wedge:
        // last-acked[ch16=3812] next-expected[ch16=172] reorder-depth=3639
        assert_eq!(server.stats.last_acked_incoming.get(&CH), Some(&3812));
        assert_eq!(server.stats.next_expected.get(&CH), Some(&172));
        assert_eq!(server.reorder_depths().get(&CH), Some(&3639));
        assert_eq!(server.stats.window_discards, 10);
        assert_eq!(server.stats.duplicate_reliable, 0);
        // ...and one retransmit of a still-buffered seq: a duplicate
        drive(&mut server, 2000, &mut delivered);
        assert_eq!(server.stats.duplicate_reliable, 1);

        // Phase 2: the > 7-windows-ahead-of-cursor shape the old rule
        // ACKed-and-dropped. 3813's retransmits stay lost too.
        for seq in 3814..=32000u16 {
            let before = delivered.len();
            drive(&mut server, seq, &mut delivered);
            assert_eq!(delivered.len(), before, "seq {seq} must buffer");
        }
        for seq in 1..=10u16 {
            drive(&mut server, seq, &mut delivered);
        }
        drive(&mut server, 4000, &mut delivered);
        // the far-ahead tail is buffered and ACKed, never discarded:
        // 30000 is ~29.8k sequences ahead of the delivery cursor, well
        // past the old rule's 7-window discard band
        assert_eq!(server.stats.last_acked_incoming.get(&CH), Some(&32000));
        assert_eq!(server.stats.next_expected.get(&CH), Some(&172));
        assert_eq!(
            server.reorder_depths().get(&CH),
            // (cursor, watermark] minus the two never-received lost
            // gap fillers (173, 3813) — every accepted seq is buffered
            Some(&(32000u16 - 172u16 - 2)),
            "every accepted seq in (cursor, watermark] is buffered"
        );
        assert_eq!(server.stats.window_discards, 20);
        assert_eq!(server.stats.duplicate_reliable, 2);

        // Resolution: the lost gap fillers finally get through.
        drive(&mut server, 173, &mut delivered);
        drive(&mut server, 3813, &mut delivered);
        assert_eq!(
            delivered,
            (1..=32000).collect::<Vec<u16>>(),
            "everything ACKed delivers in order exactly once"
        );
        assert_eq!(server.stats.next_expected.get(&CH), Some(&32000));
        assert_eq!(server.stats.last_acked_incoming.get(&CH), Some(&32000));
        assert_eq!(server.stats.window_discards, 20, "only behind-cursor retransmits were discarded");
        assert_eq!(server.stats.duplicate_reliable, 2);
        assert!(server.reorder_depths().is_empty());
    }

    /// Tripwire for the wedge signature the fix eliminates: with the
    /// invariant holding, a channel's buffered set is exactly
    /// (cursor, watermark], so "watermark far ahead with an EMPTY reorder
    /// buffer" is unreachable and the warning never fires spuriously.
    #[test]
    fn stall_warning_does_not_fire_under_normal_reorder_pressure() {
        let (mut server, now) = connected_server_with_channels(0x30);
        let from = "127.0.0.1:6000".parse().unwrap();
        let send = |channel: u8, seq: u16| {
            let mut packet = Vec::new();
            packet.extend_from_slice(&0x0000u16.to_be_bytes());
            packet.push(COMMAND_SEND_RELIABLE | FLAG_ACKNOWLEDGE);
            packet.push(channel);
            packet.extend_from_slice(&seq.to_be_bytes());
            packet.extend_from_slice(&2u16.to_be_bytes());
            packet.extend_from_slice(&seq.to_le_bytes());
            packet
        };
        // heavy out-of-order pressure on ch16 plus a healthy ch0, then
        // sit idle well past the 5s threshold
        for seq in 1..=100u16 {
            server
                .handle_datagram(from, &send(16, seq), now, &mut Vec::new())
                .unwrap();
        }
        for seq in 102..=900u16 {
            server
                .handle_datagram(from, &send(16, seq), now, &mut Vec::new())
                .unwrap();
        }
        for seq in 1..=50u16 {
            server
                .handle_datagram(from, &send(0, seq), now, &mut Vec::new())
                .unwrap();
        }
        let later = now + Duration::from_secs(11);
        assert!(
            server.stall_warnings(later).is_empty(),
            "gap with buffered messages is reorder pressure, not a wedge"
        );
    }

    /// Fuzz the receive path with seeded loss/reorder/retransmit and
    /// assert THE invariant: a reliable command is either delivered, or
    /// not acked. Window drops may only ever hit already-delivered seqs,
    /// and once every seq has been sent at least once with the final gap
    /// filled, delivery is complete and in order.
    #[test]
    fn fuzz_invariant_acked_implies_delivered() {
        let mut seed = 0x9E3779B97F4A7C15u64;
        let mut rand = move |limit: u64| {
            seed = seed
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            (seed >> 33) % limit
        };

        for round in 0..50 {
            let (mut server, now) = connected_server();
            let from = "127.0.0.1:6000".parse().unwrap();
            let send = |seq: u16| {
                let mut packet = Vec::new();
                packet.extend_from_slice(&0x0000u16.to_be_bytes());
                packet.push(COMMAND_SEND_RELIABLE | FLAG_ACKNOWLEDGE);
                packet.push(0);
                packet.extend_from_slice(&seq.to_be_bytes());
                packet.extend_from_slice(&2u16.to_be_bytes());
                packet.extend_from_slice(&seq.to_le_bytes());
                packet
            };
            let total = 50 + (rand(150) as u16);
            let mut delivered = Vec::new();
            let mut next_send = 1u16; // client's next new seq
            let mut in_flight: Vec<u16> = Vec::new(); // sent, maybe unacked

            for _ in 0..(total as u32 * 4) {
                let roll = rand(10);
                if roll < 4 && next_send <= total {
                    // client sends a new reliable (sometimes lost c->s)
                    let seq = next_send;
                    next_send += 1;
                    in_flight.push(seq);
                    if rand(10) < 7 {
                        let mut events = Vec::new();
                        server
                            .handle_datagram(from, &send(seq), now, &mut events)
                            .unwrap();
                        for event in events {
                            if let EnetEvent::Payload { payload, .. } = event {
                                delivered.push(u16::from_le_bytes(payload.try_into().unwrap()));
                            }
                        }
                    }
                } else if roll < 7 && !in_flight.is_empty() {
                    // client retransmits an old seq (its ack may have
                    // been lost s->c even though we received it)
                    let index = rand(in_flight.len() as u64) as usize;
                    let seq = in_flight[index];
                    if rand(10) < 7 {
                        let mut events = Vec::new();
                        server
                            .handle_datagram(from, &send(seq), now, &mut events)
                            .unwrap();
                        for event in events {
                            if let EnetEvent::Payload { payload, .. } = event {
                                delivered.push(u16::from_le_bytes(payload.try_into().unwrap()));
                            }
                        }
                    }
                }
                // s->c ack loss is implicit: nothing to do server-side
            }
            // fill every remaining gap so delivery can complete
            for seq in 1..=total {
                let mut events = Vec::new();
                server.handle_datagram(from, &send(seq), now, &mut events).unwrap();
                for event in events {
                    if let EnetEvent::Payload { payload, .. } = event {
                        delivered.push(u16::from_le_bytes(payload.try_into().unwrap()));
                    }
                }
            }

            // invariant: in-order, exactly once
            assert_eq!(
                delivered,
                (1..=total).collect::<Vec<u16>>(),
                "round {round}: delivery incomplete or out of order"
            );
            // window drops may only reference already-delivered seqs:
            // with the watermark at `total` afterwards, prove no drop
            // happened for any seq that had NOT been delivered by
            // checking the drop count stays within retransmitted
            // already-delivered seqs (mechanically: everything delivered)
            assert_eq!(server.stats.next_expected.get(&0), Some(&total));
        }
    }

    /// Receive-rule bounds under the widened accept range. Part 1: up to
    /// FREE windows (half the u16 space) ahead of the delivery cursor is
    /// buffered even when it dwarfs the watermark — the reference would
    /// window-discard the 7-window arrival, but we ACK on receipt so we
    /// must keep it (the client would never retransmit it). Part 2: a
    /// jump beyond FREE - 1 windows ahead of the ACCEPTED WATERMARK is
    /// the one discard that must not be ACKed (reference discard-band
    /// ACK suppression, peer.c enet_peer_queue_acknowledgement) — the
    /// client retransmits it until the cursor advances into range.
    #[test]
    fn reliable_window_bounds_the_reorder_buffer() {
        let send = |seq: u16| {
            let mut packet = Vec::new();
            packet.extend_from_slice(&0x0000u16.to_be_bytes());
            packet.push(COMMAND_SEND_RELIABLE | FLAG_ACKNOWLEDGE);
            packet.push(0);
            packet.extend_from_slice(&seq.to_be_bytes());
            packet.extend_from_slice(&2u16.to_be_bytes());
            packet.extend_from_slice(b"hi");
            packet
        };
        let from = "127.0.0.1:6000".parse().unwrap();

        // Part 1: deep out-of-order arrivals buffer, never discard.
        let (mut server, now) = connected_server();
        for seq in 1..=5u16 {
            let mut events = Vec::new();
            server.handle_datagram(from, &send(seq), now, &mut events).unwrap();
        }
        let mut events = Vec::new();
        server
            .handle_datagram(from, &send((7 * 0x1000) as u16), now, &mut events)
            .unwrap();
        server
            .handle_datagram(from, &send((6 * 0x1000) as u16), now, &mut events)
            .unwrap();
        assert_eq!(server.stats.window_discards, 0);
        assert_eq!(server.stats.send_reliable, 7);
        // both deep arrivals were ACKed on receipt
        assert_eq!(
            server.stats.last_acked_incoming.get(&0),
            Some(&(7 * 0x1000))
        );
        // and they deliver in order once the gap fills: 6..=28672 each
        // exactly once (24576 arrives via the drain when 24575 delivers,
        // so per-arrival event counts vary — assert the total)
        let mut fill_events = 0usize;
        for seq in 6..=(7 * 0x1000 - 1) as u16 {
            let mut events = Vec::new();
            server.handle_datagram(from, &send(seq), now, &mut events).unwrap();
            fill_events += events.len();
        }
        assert_eq!(fill_events, 7 * 0x1000 - 5);
        assert_eq!(
            server.stats.next_expected.get(&0),
            Some(&(7 * 0x1000))
        );
        assert_eq!(server.stats.window_discards, 0);
        assert!(server.reorder_depths().is_empty());
        // retransmits of now-delivered seqs are counted duplicates: the
        // fill loop re-sent 24576 (drained early when 24575 delivered,
        // so its fill arrival is an exact retransmit), and the final
        // retransmit of 28672
        let mut events = Vec::new();
        server
            .handle_datagram(from, &send((7 * 0x1000) as u16), now, &mut events)
            .unwrap();
        assert!(events.is_empty());
        assert_eq!(server.stats.duplicate_reliable, 2);

        // Part 2: > 7 windows ahead of the accepted watermark with
        // nothing in between (a ~28k-message loss run) is discarded and
        // NOT acked; retransmits stay un-acked until the cursor reaches
        // into range, then it delivers.
        let (mut server, now) = connected_server();
        for seq in 1..=5u16 {
            let mut events = Vec::new();
            server.handle_datagram(from, &send(seq), now, &mut events).unwrap();
        }
        for _ in 0..2 {
            let mut events = Vec::new();
            server
                .handle_datagram(from, &send(29005), now, &mut events)
                .unwrap();
            assert!(events.is_empty());
        }
        assert_eq!(server.stats.window_discards, 2);
        // and both are the ahead-of-watermark rule on ch0, not the
        // behind-cursor one: that is the question the diagnostic answers
        // (the 5s stats line reports the two counts per channel)
        assert_eq!(server.stats.discards_by_channel.get(&0), Some(&(0, 2)));
        // the watermark did not move: 29005 was never accepted
        assert_eq!(server.stats.last_acked_incoming.get(&0), Some(&5));
        // no ACK for 29005 goes out while it is in the discard band
        let datagrams = server.flush(now);
        let acked_29005 = datagrams.iter().flatten().copied().collect::<Vec<u8>>()
            .windows(8)
            .any(|w| w[0] == COMMAND_ACKNOWLEDGE
                && w[1] == 0
                && u16::from_be_bytes(w[2..4].try_into().unwrap()) == 29005);
        assert!(!acked_29005, "discard band must not be ACKed");
        // filling the gap advances the cursor into range, so 29005 is
        // accepted on retransmit and delivered in order
        for seq in 6..=29004u16 {
            let mut events = Vec::new();
            server.handle_datagram(from, &send(seq), now, &mut events).unwrap();
            assert_eq!(events.len(), 1, "seq {seq} delivers in order");
        }
        let mut events = Vec::new();
        server
            .handle_datagram(from, &send(29005), now, &mut events)
            .unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(server.stats.next_expected.get(&0), Some(&29005));
        assert_eq!(server.stats.window_discards, 2);
        assert_eq!(
            server.stats.last_acked_incoming.get(&0),
            Some(&29005)
        );
    }

    #[test]
    fn ack_datagram_echoes_the_acked_sequence() {
        // reference (enet_protocol.c send path): ACKNOWLEDGE carries the
        // acked command's own sequence in BOTH the header and
        // receivedReliableSequenceNumber, plus that command's sentTime
        let (mut server, now) = connected_server();
        let from = "127.0.0.1:6000".parse().unwrap();
        let mut packet = Vec::new();
        packet.extend_from_slice(&0x8000u16.to_be_bytes()); // FLAG_SENT_TIME
        packet.extend_from_slice(&0x1234u16.to_be_bytes()); // sentTime
        packet.push(COMMAND_SEND_RELIABLE | FLAG_ACKNOWLEDGE);
        packet.push(0x02);
        packet.extend_from_slice(&0x0042u16.to_be_bytes()); // seq 66
        packet.extend_from_slice(&2u16.to_be_bytes());
        packet.extend_from_slice(b"hi");
        let mut events = Vec::new();
        server.handle_datagram(from, &packet, now, &mut events).unwrap();

        let datagrams = server.flush(now);
        let ack = datagrams
            .iter()
            .flat_map(|d| d.windows(8))
            .find(|window| window[0] == COMMAND_ACKNOWLEDGE && window[1] == 0x02)
            .expect("ACK for channel 2");
        assert_eq!(u16::from_be_bytes(ack[2..4].try_into().unwrap()), 66);
        assert_eq!(u16::from_be_bytes(ack[4..6].try_into().unwrap()), 66);
        assert_eq!(u16::from_be_bytes(ack[6..8].try_into().unwrap()), 0x1234);
    }

    #[test]
    fn duplicate_reliable_delivery_is_counted() {        let mut server = EnetServer::new();
        let now = Instant::now();
        let mut events = Vec::new();
        server
            .handle_datagram(
                "127.0.0.1:6000".parse().unwrap(),
                &connect_datagram(0xFF, 0xFF, 7, 0),
                now,
                &mut events,
            )
            .unwrap();
        let datagrams = server.flush(now);
        server
            .handle_datagram(
                "127.0.0.1:6000".parse().unwrap(),
                &ack_of_verify(&datagrams[0]),
                now,
                &mut events,
            )
            .unwrap();
        events.clear();

        let send = |channel: u8, seq: u16, payload: &[u8]| {
            let mut packet = Vec::new();
            packet.extend_from_slice(&0x8000u16.to_be_bytes());
            packet.extend_from_slice(&0x1111u16.to_be_bytes());
            packet.push(COMMAND_SEND_RELIABLE | FLAG_ACKNOWLEDGE);
            packet.push(channel);
            packet.extend_from_slice(&seq.to_be_bytes());
            packet.extend_from_slice(&(payload.len() as u16).to_be_bytes());
            packet.extend_from_slice(payload);
            packet
        };
        let from = "127.0.0.1:6000".parse().unwrap();

        server
            .handle_datagram(from, &send(0, 1, b"first"), now, &mut events)
            .unwrap();
        assert_eq!(server.stats.send_reliable, 1);
        assert_eq!(server.stats.duplicate_reliable, 0);

        // client retransmits the same sequence: counted, not delivered twice
        server
            .handle_datagram(from, &send(0, 1, b"first"), now, &mut events)
            .unwrap();
        assert_eq!(server.stats.duplicate_reliable, 1);
        assert_eq!(server.stats.send_reliable, 2);
        let payloads: Vec<&[u8]> = events
            .iter()
            .map(|event| match event {
                EnetEvent::Payload { payload, .. } => payload.as_slice(),
                _ => panic!("unexpected event"),
            })
            .collect();
        assert_eq!(payloads, [b"first".as_slice()]);
    }

    #[test]
    fn non_enet_datagrams_are_reported() {
        let mut server = EnetServer::new();
        let now = Instant::now();
        let mut events = Vec::new();
        // raw input-style datagram: no ENet header
        let result = server.handle_datagram(
            "127.0.0.1:6000".parse().unwrap(),
            &[0xDE, 0xAD, 0xBE, 0xEF, 1, 2, 3, 4],
            now,
            &mut events,
        );
        assert!(matches!(result, Err(_)));
        assert!(server.peer_address().is_none());
    }

    /// Client WiFi roaming/rebind shape: the source port changes mid-session
    /// while the negotiated session id stays valid. Reference ENet migrates
    /// peer->address to the new source (protocol.c:1052-1056); we scope it
    /// to the same host IP and still reject the abandoned port, a wrong
    /// session, and a different host.
    #[test]
    fn peer_address_migrates_on_port_change_with_valid_session() {
        let (mut server, now) = connected_server();
        let original: std::net::SocketAddr = "127.0.0.1:6000".parse().unwrap();
        let migrated: std::net::SocketAddr = "127.0.0.1:7000".parse().unwrap();
        let send = |seq: u16| {
            let mut packet = Vec::new();
            packet.extend_from_slice(&0x8000u16.to_be_bytes()); // session 0, sent time
            packet.extend_from_slice(&0x1111u16.to_be_bytes());
            packet.push(COMMAND_SEND_RELIABLE | FLAG_ACKNOWLEDGE);
            packet.push(0);
            packet.extend_from_slice(&seq.to_be_bytes());
            packet.extend_from_slice(&2u16.to_be_bytes());
            packet.extend_from_slice(b"hi");
            packet
        };
        // wrong session from the new port: rejected, no migration
        let mut wrong_session = send(1);
        wrong_session[0] = 0x90; // session bits 01
        let result =
            server.handle_datagram(migrated, &wrong_session, now, &mut Vec::new());
        assert!(matches!(result, Err(EnetError::Invalid)));
        assert_eq!(server.peer_address(), Some(original));

        // valid session from the new port: migrates and processes
        let mut events = Vec::new();
        server
            .handle_datagram(migrated, &send(1), now, &mut events)
            .unwrap();
        assert_eq!(server.peer_address(), Some(migrated));
        assert_eq!(server.stats.send_reliable, 1);
        assert!(
            events
                .iter()
                .any(|event| matches!(event, EnetEvent::Payload { .. })),
            "migrated datagram must be processed"
        );

        // the abandoned port is stale: rejected even with a valid session
        let result =
            server.handle_datagram(original, &send(2), now, &mut Vec::new());
        assert!(matches!(result, Err(EnetError::Invalid)));
        assert_eq!(server.peer_address(), Some(migrated));
        assert_eq!(server.stats.send_reliable, 1);

        // a different host IP is still rejected outright
        let other_host: std::net::SocketAddr = "127.0.0.2:7000".parse().unwrap();
        let result =
            server.handle_datagram(other_host, &send(3), now, &mut Vec::new());
        assert!(matches!(result, Err(EnetError::Invalid)));
        assert_eq!(server.peer_address(), Some(migrated));
    }

    #[test]
    fn disconnect_acks_and_clears_peer() {
        let mut server = EnetServer::new();
        let now = Instant::now();
        let mut events = Vec::new();
        server
            .handle_datagram(
                "127.0.0.1:6000".parse().unwrap(),
                &connect_datagram(0xFF, 0xFF, 7, 0),
                now,
                &mut events,
            )
            .unwrap();
        let datagrams = server.flush(now);
        server
            .handle_datagram(
                "127.0.0.1:6000".parse().unwrap(),
                &ack_of_verify(&datagrams[0]),
                now,
                &mut events,
            )
            .unwrap();
        events.clear();

        let mut disconnect = Vec::new();
        disconnect.extend_from_slice(&0x8000u16.to_be_bytes());
        disconnect.extend_from_slice(&0x2222u16.to_be_bytes());
        disconnect.push(COMMAND_DISCONNECT | FLAG_ACKNOWLEDGE);
        disconnect.push(0xFF);
        disconnect.extend_from_slice(&3u16.to_be_bytes());
        disconnect.extend_from_slice(&0u32.to_be_bytes());
        server
            .handle_datagram(
                "127.0.0.1:6000".parse().unwrap(),
                &disconnect,
                now,
                &mut events,
            )
            .unwrap();
        assert!(matches!(events.as_slice(), [EnetEvent::Disconnected]));

        let datagrams = server.flush(now);
        assert_eq!(datagrams.len(), 1);
        assert_eq!(datagrams[0][4], COMMAND_ACKNOWLEDGE);
        assert!(server.peer_address().is_none());
    }

    #[test]
    fn server_can_send_reliable_payloads() {
        let mut server = EnetServer::new();
        let now = Instant::now();
        let mut events = Vec::new();
        server
            .handle_datagram(
                "127.0.0.1:6000".parse().unwrap(),
                &connect_datagram(0xFF, 0xFF, 7, 0),
                now,
                &mut events,
            )
            .unwrap();
        let verify = server.flush(now);
        server
            .handle_datagram(
                "127.0.0.1:6000".parse().unwrap(),
                &ack_of_verify(&verify[0]),
                now,
                &mut events,
            )
            .unwrap();

        // NVCTL termination message: type 0x0109 (LE) + ec (BE)
        let mut termination = Vec::new();
        termination.extend_from_slice(&0x0109u16.to_le_bytes());
        termination.extend_from_slice(&0u32.to_be_bytes());
        server.send_reliable(0, &termination).unwrap();

        let datagrams = server.flush(now);
        let datagram = datagrams.last().unwrap();
        let command_at = 4 + 8 * count_acks(datagram);
        assert_eq!(datagram[command_at] & COMMAND_MASK, COMMAND_SEND_RELIABLE);
        assert_eq!(datagram[command_at + 1], 0);
        assert_eq!(u16::from_be_bytes(datagram[command_at + 2..command_at + 4].try_into().unwrap()), 1);
        let len = u16::from_be_bytes(datagram[command_at + 4..command_at + 6].try_into().unwrap()) as usize;
        let body = &datagram[command_at + 6..command_at + 6 + len];
        assert_eq!(body, &termination);

        // retransmitted while unacked
        let resend = server.flush(now + RETRANSMIT_TIMEOUT + Duration::from_millis(1));
        assert!(resend.iter().any(|d| d.windows(termination.len()).any(|w| w == termination.as_slice())));
    }

    fn count_acks(datagram: &[u8]) -> usize {
        let mut count = 0;
        let mut offset = 4;
        while offset + 8 <= datagram.len() && datagram[offset] == COMMAND_ACKNOWLEDGE {
            count += 1;
            offset += 8;
        }
        count
    }
}
