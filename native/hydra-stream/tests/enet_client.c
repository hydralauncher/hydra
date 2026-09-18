// Differential harness: the REAL reference ENet client (cgutman/enet,
// the fork moonlight-common-c vendors) against our hand-rolled Rust
// server. Success criterion: our ACKs are processed by the reference
// client — measured by its sentReliableCommands draining (commands are
// only removed when their ACK arrives) and its RTT leaving the default.
#include <enet/enet.h>
#include <stdio.h>
#include <stdlib.h>
#include <winsock2.h>
#include <string.h>

int main(int argc, char **argv) {
    if (argc < 3) {
        fprintf(stderr, "usage: enet_client <host> <port>\n");
        return 2;
    }
    if (enet_initialize() != 0) {
        printf("RESULT FAIL enet_initialize\n");
        return 1;
    }

    ENetAddress address;
    memset(&address, 0, sizeof(address));
    struct sockaddr_in *sin = (struct sockaddr_in *)&address.address;
    sin->sin_family = AF_INET;
    sin->sin_port = htons((unsigned short)atoi(argv[2]));
    sin->sin_addr.s_addr = inet_addr(argv[1]);
    address.addressLength = sizeof(*sin);

    ENetHost *client = enet_host_create(AF_INET, NULL, 1, 8, 0, 0);
    if (client == NULL) {
        printf("RESULT FAIL host_create\n");
        return 1;
    }

    ENetPeer *peer = enet_host_connect(client, &address, 8, 0xDEADBEEF);
    if (peer == NULL) {
        printf("RESULT FAIL connect_alloc\n");
        return 1;
    }

    ENetEvent event;
    int connected = 0;
    while (enet_host_service(client, &event, 5000) > 0) {
        if (event.type == ENET_EVENT_TYPE_CONNECT) {
            connected = 1;
            break;
        }
        if (event.type == ENET_EVENT_TYPE_DISCONNECT) break;
    }
    if (!connected) {
        printf("RESULT FAIL handshake state=%d\n", peer->state);
        return 1;
    }
    printf("connected, rtt_default=%u\n", peer->roundTripTime);

    // 100 reliables on channel 0, serviced steadily
    for (int i = 1; i <= 100; i++) {
        char payload[32];
        int len = snprintf(payload, sizeof(payload), "message-%d", i) + 1;
        ENetPacket *packet =
            enet_packet_create(payload, len, ENET_PACKET_FLAG_RELIABLE);
        enet_peer_send(peer, 0, packet);
        enet_host_flush(client);
        enet_host_service(client, &event, 5);
    }

    // give the server's ACKs time to arrive and be processed
    int outstanding = -1;
    for (int t = 0; t < 800; t++) {
        while (enet_host_service(client, &event, 25) > 0) {
        }
        outstanding = (int)(enet_list_size(&peer->sentReliableCommands) +
                            enet_list_size(&peer->outgoingReliableCommands));
        if (outstanding == 0) break;
    }

    int rtt_moved = peer->roundTripTime != 500; // default round trip time
    printf("final outstanding=%d rtt=%u state=%d\n", outstanding,
           peer->roundTripTime, peer->state);
    printf("RESULT %s\n",
           (outstanding == 0 && rtt_moved && peer->state == ENET_PEER_STATE_CONNECTED)
               ? "OK"
               : "FAIL");

    enet_peer_disconnect_now(peer, 0);
    enet_host_destroy(client);
    enet_deinitialize();
    return (outstanding == 0 && rtt_moved) ? 0 : 1;
}
