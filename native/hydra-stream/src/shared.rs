//! Cross-adapter texture sharing: hands the scaler's output from the
//! display-owning GPU to the encoder on a second GPU. DXGI desktop
//! duplication and the D3D11 video processor must live on the adapter that
//! owns the output, so capture/scaling stay there and only the finished
//! BGRA frame crosses to the offload adapter (no CPU roundtrip).
//!
//! Sharing mechanism (D3D11.1): the shared textures are created on the
//! producer (capture) device with D3D11_RESOURCE_MISC_SHARED_NTHANDLE and
//! handed to the consumer device as an NT handle
//! (IDXGIResource1::CreateSharedHandle ->
//! ID3D11Device1::OpenSharedResource1). The legacy D3D11_RESOURCE_MISC_SHARED
//! model fails cross-adapter with E_INVALIDARG (verified on multi-GPU
//! systems) and is mutually exclusive with SHARED_KEYEDMUTEX (MSDN
//! D3D11_RESOURCE_MISC_FLAG); NT handles are the cross-GPU path (MSDN:
//! sharing resources between GPUs). The texture must be a non-mipmapped
//! 2D DEFAULT-usage texture with only RENDER_TARGET/SHADER_RESOURCE bind
//! flags.
//!
//! Sync discipline — the two GPUs must never race on a slot:
//! 1. Keyed mutex (preferred, the standard shared-surface sync): each
//!    device QIs its own IDXGIKeyedMutex from the shared texture (one per
//!    device, per MSDN). Producer: AcquireSync(0) -> render -> ReleaseSync(1);
//!    consumer: AcquireSync(1) -> encode -> ReleaseSync(0). A freshly
//!    created mutex is unowned and only a key of 0 succeeds on it (MSDN
//!    IDXGIKeyedMutex::AcquireSync remarks), hence the 0/1 ping-pong; the
//!    keys also match the docs' own example. AcquireSync's release-key
//!    wait makes the producer's rendered content visible to the consumer.
//! 2. Shared fence (D3D11.3 fallback): one ID3D11Fence created on the
//!    producer device, shared via ID3D11Fence::CreateSharedHandle and
//!    opened on the consumer (ID3D11Device5::OpenSharedFence); ordering is
//!    pure GPU-side through ID3D11DeviceContext4::Wait/Signal, used when
//!    keyed mutexes cannot be created or opened cross-adapter.
//!
//! The ring never lets the GPUs touch the same slot concurrently: a slot
//! is handed to the producer only after the consumer released it, and the
//! consumer holds it until the bitstream that consumed it was delivered
//! (encoder depth stays ~2 on the low-latency path, so with 4 slots the
//! producer is never starved; a busy producer acquire drops the frame
//! instead of blocking — the freshness policy would drop it anyway).

use std::ffi::c_void;
use std::ptr;
use std::time::{Duration, Instant};

use windows::core::{Interface, PCWSTR};
use windows::Win32::Foundation::{CloseHandle, HANDLE, HMODULE};
use windows::Win32::Graphics::Direct3D::{D3D_DRIVER_TYPE_UNKNOWN, D3D_FEATURE_LEVEL_11_0};
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11Device1, ID3D11Device5, ID3D11DeviceContext,
    ID3D11DeviceContext4, ID3D11Fence, ID3D11Texture2D, D3D11_BIND_RENDER_TARGET,
    D3D11_BIND_SHADER_RESOURCE, D3D11_CREATE_DEVICE_BGRA_SUPPORT,
    D3D11_CREATE_DEVICE_VIDEO_SUPPORT, D3D11_FENCE_FLAG_NONE, D3D11_RESOURCE_MISC_SHARED,
    D3D11_RESOURCE_MISC_SHARED_KEYEDMUTEX, D3D11_RESOURCE_MISC_SHARED_NTHANDLE,
    D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_DEFAULT,
};
use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC};
use windows::Win32::Graphics::Dxgi::{
    IDXGIAdapter, IDXGIKeyedMutex, IDXGIResource1, DXGI_SHARED_RESOURCE_READ,
    DXGI_SHARED_RESOURCE_WRITE,
};

/// Ring depth: covers the encoder's maximum in-flight frames (~2 on the
/// low-latency path) plus producer headroom, so `begin_produce` virtually
/// never finds every slot busy.
const RING_SLOTS: usize = 4;

/// Keyed-mutex keys. A freshly created mutex is unowned and accepts only
/// key 0 (MSDN AcquireSync remarks), so the producer — the device that
/// created the texture — always acquires with 0 and hands off with 1.
const PRODUCER_ACQUIRE_KEY: u64 = 0;
const PRODUCER_RELEASE_KEY: u64 = 1;

/// Consumer-side sanity timeout for AcquireSync: the producer released one
/// call earlier on this same thread, so a wait here can only trip on a
/// driver bug; treated as a recreate-worthy error.
const CONSUME_ACQUIRE_TIMEOUT_MS: u32 = 2000;

/// AcquireSync returns these Win32 wait codes as plain DWORDs in the
/// HRESULT slot (MSDN return-value list).
const WAIT_ABANDONED: u32 = 0x80;
const WAIT_TIMEOUT: u32 = 0x102;

pub enum BeginProduceError {
    /// Every ring slot is still inside the encoder; the caller should drop
    /// this frame instead of blocking the sender thread.
    Busy,
    /// The sync object broke; the caller should recreate the pipeline.
    Failed(String),
}

enum BridgeSync {
    KeyedMutex,
    Fence(FenceSync),
}

struct FenceSync {
    fence: ID3D11Fence,
    producer_context: ID3D11DeviceContext4,
    consumer_context: ID3D11DeviceContext4,
    /// Monotonic value for the next GPU-side Signal (0/1 were spent on
    /// the init probe).
    next_value: u64,
}

struct SharedSlot {
    producer_texture: ID3D11Texture2D,
    consumer_texture: ID3D11Texture2D,
    handle: HANDLE,
    producer_mutex: Option<IDXGIKeyedMutex>,
    consumer_mutex: Option<IDXGIKeyedMutex>,
    /// Fence value the producer signaled after rendering this slot (the
    /// consumer waits on it); 0 = never rendered.
    produced_value: u64,
    /// Fence value the consumer signaled after the encoder consumed this
    /// slot (the producer waits on it before re-rendering); 0 = the
    /// initial probe, which completes immediately.
    done_value: u64,
}

impl Drop for SharedSlot {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.handle);
        }
    }
}

/// Producer = capture/scaler device (display adapter); consumer = the
/// offload device the encoder's AMF session runs on.
// Raw driver handles are only touched from the video thread.
unsafe impl Send for CrossAdapterBridge {}

pub struct CrossAdapterBridge {
    producer_context: ID3D11DeviceContext,
    consumer_device: ID3D11Device,
    consumer_context: ID3D11DeviceContext,
    sync: BridgeSync,
    slots: Vec<SharedSlot>,
    next: usize,
}

impl CrossAdapterBridge {
    /// Creates the consumer device on `consumer_adapter`, then builds the
    /// shared-texture ring. Keyed mutex is probed first (create with
    /// SHARED_KEYEDMUTEX, open cross-adapter, full acquire/release round
    /// trip per slot); any failure falls back to the D3D11.3 shared-fence
    /// protocol, whose probe signals once on the producer and requires the
    /// value to complete. Returns Err when cross-adapter sharing is not
    /// supported at all (the caller falls back to the display adapter).
    pub fn new(
        producer_device: &ID3D11Device,
        consumer_adapter: &IDXGIAdapter,
        width: u32,
        height: u32,
    ) -> Result<Self, String> {
        unsafe {
            let mut device: Option<ID3D11Device> = None;
            let mut context: Option<ID3D11DeviceContext> = None;
            D3D11CreateDevice(
                consumer_adapter,
                D3D_DRIVER_TYPE_UNKNOWN,
                HMODULE(ptr::null_mut()),
                D3D11_CREATE_DEVICE_BGRA_SUPPORT | D3D11_CREATE_DEVICE_VIDEO_SUPPORT,
                Some(&[D3D_FEATURE_LEVEL_11_0]),
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                Some(&mut context),
            )
            .map_err(|error| format!("offload D3D11CreateDevice: {error}"))?;
            let consumer_device = device.ok_or("D3D11CreateDevice returned no offload device")?;
            let consumer_context = context.ok_or("D3D11CreateDevice returned no offload context")?;
            let producer_context = producer_device
                .GetImmediateContext()
                .map_err(|error| format!("producer GetImmediateContext: {error}"))?;

            let slots = match Self::build_slots(producer_device, &consumer_device, width, height, true)
            {
                Ok(slots) => {
                    eprintln!(
                        "cross-adapter: keyed-mutex ring ({} slots, {width}x{height} BGRA)",
                        slots.len()
                    );
                    CrossAdapterBridge {
                        producer_context,
                        consumer_device,
                        consumer_context,
                        sync: BridgeSync::KeyedMutex,
                        slots,
                        next: 0,
                    }
                }
                Err(keyed_error) => {
                    eprintln!(
                        "cross-adapter: keyed mutex unusable ({keyed_error}); trying D3D11.3 shared fence"
                    );
                    let slots = Self::build_slots(
                        producer_device,
                        &consumer_device,
                        width,
                        height,
                        false,
                    )?;
                    let sync =
                        Self::build_fence(producer_device, &consumer_device)?;
                    eprintln!(
                        "cross-adapter: shared-fence ring ({} slots, {width}x{height} BGRA)",
                        slots.len()
                    );
                    CrossAdapterBridge {
                        producer_context,
                        consumer_device,
                        consumer_context,
                        sync: BridgeSync::Fence(sync),
                        slots,
                        next: 0,
                    }
                }
            };
            Ok(slots)
        }
    }

    pub fn consumer_device_ptr(&self) -> *mut c_void {
        self.consumer_device.as_raw()
    }

    pub fn sync_label(&self) -> &'static str {
        match &self.sync {
            BridgeSync::KeyedMutex => "keyed-mutex",
            BridgeSync::Fence(_) => "shared-fence",
        }
    }

    pub fn producer_texture(&self, slot: usize) -> ID3D11Texture2D {
        self.slots[slot].producer_texture.clone()
    }

    pub fn consumer_texture(&self, slot: usize) -> ID3D11Texture2D {
        self.slots[slot].consumer_texture.clone()
    }

    /// Rotates the ring and takes the producer side of the next slot.
    /// Non-blocking in keyed-mutex mode: `Busy` means every slot is still
    /// inside the encoder and the caller should drop the frame.
    pub fn begin_produce(&mut self) -> Result<usize, BeginProduceError> {
        let slot = self.next;
        self.next = (self.next + 1) % self.slots.len();
        match &self.sync {
            BridgeSync::KeyedMutex => {
                let mutex = self.slots[slot]
                    .producer_mutex
                    .as_ref()
                    .expect("keyed-mutex slot")
                    .clone();
                match unsafe { mutex.AcquireSync(PRODUCER_ACQUIRE_KEY, 0) } {
                    Ok(()) => Ok(slot),
                    // WAIT_ABANDONED: the surface and mutex are no longer
                    // consistent — recreate (MSDN AcquireSync).
                    Err(error) if error.code().0 as u32 == WAIT_TIMEOUT => {
                        Err(BeginProduceError::Busy)
                    }
                    Err(error) => Err(BeginProduceError::Failed(format!(
                        "producer AcquireSync ({}): {error}",
                        wait_code_name(error.code().0 as u32)
                    ))),
                }
            }
            BridgeSync::Fence(sync) => {
                let (fence, context) = (sync.fence.clone(), sync.producer_context.clone());
                let done = self.slots[slot].done_value;
                unsafe {
                    context
                        .Wait(&fence, done)
                        .map_err(|error| BeginProduceError::Failed(format!("producer fence wait: {error}")))?;
                }
                Ok(slot)
            }
        }
    }

    /// Hands a rendered slot to the consumer: releases the producer side
    /// (keyed mutex) or signals the fence after the render, then flushes
    /// the producer queue so the hand-off reaches the other GPU promptly.
    pub fn finish_produce(&mut self, slot: usize) -> Result<(), String> {
        if let BridgeSync::Fence(sync) = &self.sync {
            let (fence, context) = (sync.fence.clone(), sync.producer_context.clone());
            let value = sync.next_value;
            unsafe {
                context
                    .Signal(&fence, value)
                    .map_err(|error| format!("producer fence signal: {error}"))?;
            }
            self.slots[slot].produced_value = value;
            // without a flush the render + signal can sit in the producer
            // queue while the consumer waits on the fence value
            unsafe {
                self.producer_context.Flush();
            }
            if let BridgeSync::Fence(sync) = &mut self.sync {
                sync.next_value = value + 1;
            }
            return Ok(());
        }
        let mutex = self.slots[slot]
            .producer_mutex
            .as_ref()
            .expect("keyed-mutex slot")
            .clone();
        unsafe {
            mutex
                .ReleaseSync(PRODUCER_RELEASE_KEY)
                .map_err(|error| format!("producer ReleaseSync: {error}"))
        }
    }

    /// Takes the consumer side after `finish_produce` so the AMF session
    /// on the offload device reads a fully synchronized surface.
    pub fn begin_consume(&mut self, slot: usize) -> Result<(), String> {
        match &self.sync {
            BridgeSync::KeyedMutex => {
                let mutex = self.slots[slot]
                    .consumer_mutex
                    .as_ref()
                    .expect("keyed-mutex slot")
                    .clone();
                unsafe {
                    mutex
                        .AcquireSync(PRODUCER_RELEASE_KEY, CONSUME_ACQUIRE_TIMEOUT_MS)
                        .map_err(|error| format!("consumer AcquireSync: {error}"))
                }
            }
            BridgeSync::Fence(sync) => {
                let (fence, context) = (sync.fence.clone(), sync.consumer_context.clone());
                let value = self.slots[slot].produced_value;
                unsafe {
                    context
                        .Wait(&fence, value)
                        .map_err(|error| format!("consumer fence wait: {error}"))
                }
            }
        }
    }

    /// Releases the consumer side once the bitstream that consumed the
    /// slot was delivered; the slot only re-enters the producer ring after
    /// this, so the GPUs never write and read it at the same time.
    pub fn finish_consume(&mut self, slot: usize) -> Result<(), String> {
        if let BridgeSync::Fence(sync) = &self.sync {
            let (fence, context) = (sync.fence.clone(), sync.consumer_context.clone());
            let value = sync.next_value;
            unsafe {
                context
                    .Signal(&fence, value)
                    .map_err(|error| format!("consumer fence signal: {error}"))?;
            }
            self.slots[slot].done_value = value;
            // push the AMF reads and this signal to the offload GPU so the
            // producer's wait on the slot makes progress
            unsafe {
                self.consumer_context.Flush();
            }
            if let BridgeSync::Fence(sync) = &mut self.sync {
                sync.next_value = value + 1;
            }
            return Ok(());
        }
        let mutex = self.slots[slot]
            .consumer_mutex
            .as_ref()
            .expect("keyed-mutex slot")
            .clone();
        unsafe {
            mutex
                .ReleaseSync(PRODUCER_ACQUIRE_KEY)
                .map_err(|error| format!("consumer ReleaseSync: {error}"))
        }
    }

    /// Creates the ring: shared textures on the producer device, NT
    /// handles, opened on the consumer device. With `keyed` every slot is
    /// round-trip probed (create -> open -> acquire/release on both
    /// devices); the first producer acquire must use key 0.
    unsafe fn build_slots(
        producer_device: &ID3D11Device,
        consumer_device: &ID3D11Device,
        width: u32,
        height: u32,
        keyed: bool,
    ) -> Result<Vec<SharedSlot>, String> {
        let mut desc = D3D11_TEXTURE2D_DESC::default();
        desc.Width = width;
        desc.Height = height;
        desc.MipLevels = 1;
        desc.ArraySize = 1;
        desc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
        desc.SampleDesc = DXGI_SAMPLE_DESC {
            Count: 1,
            Quality: 0,
        };
        desc.Usage = D3D11_USAGE_DEFAULT;
        desc.BindFlags = (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_SHADER_RESOURCE.0) as u32;
        desc.MiscFlags = if keyed {
            // NTHANDLE must be combined with KEYEDMUTEX (SHARED and
            // KEYEDMUTEX are mutually exclusive, and a bare NTHANDLE
            // texture fails creation — both verified against the drivers;
            // MSDN D3D11_RESOURCE_MISC_FLAG recommends this combo)
            (D3D11_RESOURCE_MISC_SHARED_NTHANDLE.0 | D3D11_RESOURCE_MISC_SHARED_KEYEDMUTEX.0)
                as u32
        } else {
            // fence-sync slots carry no keyed mutex: the legacy SHARED
            // flag plus NTHANDLE (the Chrome/ANGLE cross-process combo)
            (D3D11_RESOURCE_MISC_SHARED.0 | D3D11_RESOURCE_MISC_SHARED_NTHANDLE.0) as u32
        };

        let consumer_device1: ID3D11Device1 = consumer_device
            .cast()
            .map_err(|error| format!("consumer ID3D11Device1: {error}"))?;

        let mut slots = Vec::with_capacity(RING_SLOTS);
        for _ in 0..RING_SLOTS {
            slots.push(Self::build_slot(
                producer_device,
                &consumer_device1,
                &desc,
                keyed,
            )?);
        }
        if keyed {
            for (index, slot) in slots.iter().enumerate() {
                slot.producer_mutex
                    .as_ref()
                    .expect("keyed-mutex probe")
                    .AcquireSync(PRODUCER_ACQUIRE_KEY, CONSUME_ACQUIRE_TIMEOUT_MS)
                    .map_err(|error| format!("slot {index} probe acquire (producer): {error}"))?;
                slot.producer_mutex
                    .as_ref()
                    .expect("keyed-mutex probe")
                    .ReleaseSync(PRODUCER_RELEASE_KEY)
                    .map_err(|error| format!("slot {index} probe release (producer): {error}"))?;
                slot.consumer_mutex
                    .as_ref()
                    .expect("keyed-mutex probe")
                    .AcquireSync(PRODUCER_RELEASE_KEY, CONSUME_ACQUIRE_TIMEOUT_MS)
                    .map_err(|error| format!("slot {index} probe acquire (consumer): {error}"))?;
                slot.consumer_mutex
                    .as_ref()
                    .expect("keyed-mutex probe")
                    .ReleaseSync(PRODUCER_ACQUIRE_KEY)
                    .map_err(|error| format!("slot {index} probe release (consumer): {error}"))?;
            }
        }
        Ok(slots)
    }

    /// One shared texture: create on the producer, NT handle, open on the
    /// consumer. Every error path closes the handle.
    unsafe fn build_slot(
        producer_device: &ID3D11Device,
        consumer_device1: &ID3D11Device1,
        desc: &D3D11_TEXTURE2D_DESC,
        keyed: bool,
    ) -> Result<SharedSlot, String> {
        let mut texture = None;
        producer_device
            .CreateTexture2D(desc, None, Some(&mut texture))
            .map_err(|error| format!("CreateTexture2D (shared): {error}"))?;
        let producer_texture = texture.ok_or("CreateTexture2D returned no shared texture")?;
        let resource: IDXGIResource1 = producer_texture
            .cast()
            .map_err(|error| format!("IDXGIResource1: {error}"))?;
        let handle = resource
            .CreateSharedHandle(
                None,
                DXGI_SHARED_RESOURCE_READ.0 | DXGI_SHARED_RESOURCE_WRITE.0,
                PCWSTR::null(),
            )
            .map_err(|error| format!("CreateSharedHandle: {error}"))?;
        let consumer_texture: ID3D11Texture2D = match consumer_device1.OpenSharedResource1(handle) {
            Ok(texture) => texture,
            Err(error) => {
                let _ = CloseHandle(handle);
                return Err(format!("OpenSharedResource1: {error}"));
            }
        };
        let (producer_mutex, consumer_mutex) = if keyed {
            let producer_mutex = match producer_texture.cast::<IDXGIKeyedMutex>() {
                Ok(mutex) => mutex,
                Err(error) => {
                    let _ = CloseHandle(handle);
                    return Err(format!("producer IDXGIKeyedMutex: {error}"));
                }
            };
            let consumer_mutex = match consumer_texture.cast::<IDXGIKeyedMutex>() {
                Ok(mutex) => mutex,
                Err(error) => {
                    let _ = CloseHandle(handle);
                    return Err(format!("consumer IDXGIKeyedMutex: {error}"));
                }
            };
            (Some(producer_mutex), Some(consumer_mutex))
        } else {
            (None, None)
        };
        Ok(SharedSlot {
            producer_texture,
            consumer_texture,
            handle,
            producer_mutex,
            consumer_mutex,
            produced_value: 0,
            done_value: 0,
        })
    }

    /// The D3D11.3 sync path: one fence created on the producer, shared
    /// via NT handle, opened on the consumer. Probed with a real signal ->
    /// complete round trip so a half-broken cross-device fence fails here
    /// instead of silently stalling every frame.
    unsafe fn build_fence(
        producer_device: &ID3D11Device,
        consumer_device: &ID3D11Device,
    ) -> Result<FenceSync, String> {
        let producer5: ID3D11Device5 = producer_device
            .cast()
            .map_err(|error| format!("producer ID3D11Device5: {error}"))?;
        let mut fence: Option<ID3D11Fence> = None;
        producer5
            .CreateFence(0, D3D11_FENCE_FLAG_NONE, &mut fence)
            .map_err(|error| format!("CreateFence: {error}"))?;
        let fence = fence.ok_or("CreateFence returned no fence")?;
        let handle = fence
            .CreateSharedHandle(None, 0, PCWSTR::null())
            .map_err(|error| format!("fence CreateSharedHandle: {error}"))?;
        let consumer5: ID3D11Device5 = consumer_device
            .cast()
            .map_err(|error| format!("consumer ID3D11Device5: {error}"))?;
        let mut opened: Option<ID3D11Fence> = None;
        match consumer5.OpenSharedFence(handle, &mut opened) {
            Ok(()) => {}
            Err(error) => {
                let _ = CloseHandle(handle);
                return Err(format!("OpenSharedFence: {error}"));
            }
        }
        let opened = opened.ok_or("OpenSharedFence returned no fence")?;
        let _ = CloseHandle(handle);
        let producer_context: ID3D11DeviceContext4 = producer_device
            .GetImmediateContext()
            .map_err(|error| format!("producer GetImmediateContext: {error}"))?
            .cast()
            .map_err(|error| format!("producer ID3D11DeviceContext4: {error}"))?;
        let consumer_context: ID3D11DeviceContext4 = consumer_device
            .GetImmediateContext()
            .map_err(|error| format!("consumer GetImmediateContext: {error}"))?
            .cast()
            .map_err(|error| format!("consumer ID3D11DeviceContext4: {error}"))?;
        producer_context
            .Signal(&fence, 1)
            .map_err(|error| format!("probe Signal: {error}"))?;
        producer_device
            .GetImmediateContext()
            .map_err(|error| format!("producer GetImmediateContext: {error}"))?
            .Flush();
        let deadline = Instant::now() + Duration::from_secs(2);
        while opened.GetCompletedValue() < 1 {
            if Instant::now() >= deadline {
                return Err("shared fence probe timed out (cross-device signal never completed)".to_string());
            }
            std::thread::sleep(Duration::from_millis(1));
        }
        Ok(FenceSync {
            fence,
            producer_context,
            consumer_context,
            next_value: 2,
        })
    }
}

fn wait_code_name(code: u32) -> &'static str {
    match code {
        WAIT_ABANDONED => "WAIT_ABANDONED",
        WAIT_TIMEOUT => "WAIT_TIMEOUT",
        _ => "error",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ptr;
    use windows::Win32::Foundation::HMODULE;
    use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_UNKNOWN;
    use windows::Win32::Graphics::Direct3D11::D3D11CreateDevice;
    use windows::Win32::Graphics::Direct3D11::{
        ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D, D3D11_BIND_RENDER_TARGET,
        D3D11_BIND_SHADER_RESOURCE, D3D11_CREATE_DEVICE_BGRA_SUPPORT,
        D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC,
    };
    use windows::Win32::Graphics::Dxgi::Common::{
        DXGI_FORMAT, DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_FORMAT_R8G8B8A8_UNORM, DXGI_SAMPLE_DESC,
    };
    use windows::Win32::Graphics::Dxgi::{
        CreateDXGIFactory1, IDXGIAdapter, IDXGIFactory1, IDXGIKeyedMutex, IDXGIResource1,
        DXGI_SHARED_RESOURCE_READ, DXGI_SHARED_RESOURCE_WRITE,
    };

    /// Creates a D3D11 device on the given adapter.
    unsafe fn device_on(adapter: &IDXGIAdapter) -> Result<ID3D11Device, String> {
        let mut device: Option<ID3D11Device> = None;
        let mut context: Option<ID3D11DeviceContext> = None;
        D3D11CreateDevice(
            adapter,
            D3D_DRIVER_TYPE_UNKNOWN,
            HMODULE(ptr::null_mut()),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            Some(&[D3D_FEATURE_LEVEL_11_0]),
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut context),
        )
        .map_err(|error| format!("D3D11CreateDevice: {error}"))?;
        device.ok_or_else(|| "no device".to_string())
    }

    /// Creates a shared texture on `producer` and tries to open it on
    /// `consumer`; with `keyed` also round-trips the keyed mutex on both
    /// devices. Returns a probe log line.
    unsafe fn probe_pair(
        label: &str,
        producer: &ID3D11Device,
        consumer: &ID3D11Device,
        format: DXGI_FORMAT,
        bind: u32,
        keyed: bool,
    ) -> String {
        let mut desc = D3D11_TEXTURE2D_DESC::default();
        desc.Width = 640;
        desc.Height = 360;
        desc.MipLevels = 1;
        desc.ArraySize = 1;
        desc.Format = format;
        desc.SampleDesc = DXGI_SAMPLE_DESC {
            Count: 1,
            Quality: 0,
        };
        desc.Usage = D3D11_USAGE_DEFAULT;
        desc.BindFlags = bind;
        desc.MiscFlags = (D3D11_RESOURCE_MISC_SHARED_NTHANDLE.0
            | if keyed {
                D3D11_RESOURCE_MISC_SHARED_KEYEDMUTEX.0
            } else {
                0
            }) as u32;
        let mut texture = None;
        let producer_texture = match producer.CreateTexture2D(&desc, None, Some(&mut texture)) {
            Ok(()) => texture.expect("texture"),
            Err(error) => return format!("{label}: create: {error}"),
        };
        let resource: IDXGIResource1 = match producer_texture.cast() {
            Ok(resource) => resource,
            Err(error) => return format!("{label}: IDXGIResource1 cast: {error}"),
        };
        let handle = match resource.CreateSharedHandle(
            None,
            DXGI_SHARED_RESOURCE_READ.0 | DXGI_SHARED_RESOURCE_WRITE.0,
            PCWSTR::null(),
        ) {
            Ok(handle) => handle,
            Err(error) => return format!("{label}: CreateSharedHandle: {error}"),
        };
        let consumer1: ID3D11Device1 = match consumer.cast() {
            Ok(device) => device,
            Err(error) => {
                let _ = CloseHandle(handle);
                return format!("{label}: consumer ID3D11Device1: {error}");
            }
        };
        let opened: windows::core::Result<ID3D11Texture2D> = consumer1.OpenSharedResource1(handle);
        let _ = CloseHandle(handle);
        let consumer_texture = match opened {
            Ok(texture) => texture,
            Err(error) => return format!("{label}: open: {error}"),
        };
        if keyed {
            let pm = match producer_texture.cast::<IDXGIKeyedMutex>() {
                Ok(mutex) => mutex,
                Err(error) => return format!("{label}: producer mutex QI: {error}"),
            };
            let cm = match consumer_texture.cast::<IDXGIKeyedMutex>() {
                Ok(mutex) => mutex,
                Err(error) => return format!("{label}: consumer mutex QI: {error}"),
            };
            if let Err(error) = pm.AcquireSync(0, 2000) {
                return format!("{label}: producer acquire: {error}");
            }
            if let Err(error) = pm.ReleaseSync(1) {
                return format!("{label}: producer release: {error}");
            }
            if let Err(error) = cm.AcquireSync(1, 2000) {
                return format!("{label}: consumer acquire: {error}");
            }
            if let Err(error) = cm.ReleaseSync(0) {
                return format!("{label}: consumer release: {error}");
            }
        }
        format!("{label}: OK")
    }

    /// Hardware probe (run with --ignored on the real machine): which
    /// cross-adapter shared-texture combinations does THIS driver pair
    /// actually allow? Ground truth for the amf-cross bridge design:
    /// creation direction, pixel format, bind flags, keyed mutex. A pair
    /// prints OK only when create + NT-handle share + open (+ full keyed
    /// round trip) all succeed.
    #[test]
    #[ignore]
    fn probe_cross_adapter_sharing_matrix() {
        unsafe {
            let factory: IDXGIFactory1 = CreateDXGIFactory1().expect("CreateDXGIFactory1");
            let mut adapters: Vec<IDXGIAdapter> = Vec::new();
            for index in 0..16 {
                match factory.EnumAdapters(index) {
                    Ok(adapter) => adapters.push(adapter),
                    Err(_) => break,
                }
            }
            let devices: Vec<(String, ID3D11Device)> = adapters
                .iter()
                .map(|adapter| {
                    let desc = adapter.GetDesc().expect("GetDesc");
                    let name = String::from_utf16_lossy(&desc.Description)
                        .trim_end_matches('\0')
                        .to_string();
                    (name, device_on(adapter).expect("device"))
                })
                .collect();
            for (name, _) in &devices {
                eprintln!("adapter: {name}");
            }
            let rtv = D3D11_BIND_RENDER_TARGET.0 as u32;
            let srv = D3D11_BIND_SHADER_RESOURCE.0 as u32;
            let combos: &[(DXGI_FORMAT, u32, &str)] = &[
                (DXGI_FORMAT_B8G8R8A8_UNORM, rtv | srv, "BGRA rtv|srv"),
                (DXGI_FORMAT_B8G8R8A8_UNORM, rtv, "BGRA rtv"),
                (DXGI_FORMAT_B8G8R8A8_UNORM, srv, "BGRA srv"),
                (DXGI_FORMAT_B8G8R8A8_UNORM, 0, "BGRA bind0"),
                (DXGI_FORMAT_R8G8B8A8_UNORM, rtv | srv, "RGBA rtv|srv"),
                (DXGI_FORMAT_R8G8B8A8_UNORM, srv, "RGBA srv"),
            ];
            for (a, (name_a, device_a)) in devices.iter().enumerate() {
                // same-adapter sanity (keyed and fence-style)
                for keyed in [true, false] {
                    eprintln!(
                        "{}",
                        probe_pair(
                            &format!("{name_a} -> itself ({}, keyed={keyed})", combos[0].2),
                            device_a,
                            device_a,
                            combos[0].0,
                            combos[0].1,
                            keyed
                        )
                    );
                }
                for (b, (name_b, device_b)) in devices.iter().enumerate() {
                    if a == b {
                        continue;
                    }
                    for (format, bind, label) in combos {
                        eprintln!(
                            "{}",
                            probe_pair(
                                &format!("{name_a} -> {name_b} ({label}, keyed=true)"),
                                device_a,
                                device_b,
                                *format,
                                *bind,
                                true
                            )
                        );
                    }
                }
            }
        }
    }
}
