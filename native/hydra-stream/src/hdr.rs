//! scRGB (FP16 linear) -> HDR10 (BT.2020 + PQ) conversion into the P010
//! surface NVENC encodes.
//!
//! The D3D11 video processor cannot do this one: `R16G16B16A16_FLOAT` is
//! output-only for it (`CheckVideoProcessorFormat` answers 0x2, i.e. no input
//! support) and an FP16 `CreateVideoProcessorInputView` fails with
//! `E_INVALIDARG` — both measured on the RTX 5070. So the HDR path is a
//! shader pass, the split Sunshine makes in `display_vram.cpp:505-538`, and
//! the maths is Sunshine's (`include/common.hlsl`,
//! `video_colorspace.cpp:140-206`):
//!
//! * scRGB is linear with Rec.709/sRGB primaries and 1.0 *is* 80 nits
//!   (`scRGBTo2100PQ` multiplies by 80 before the transfer function),
//! * the primaries rotate to Rec.2020 through the standard 3x3,
//! * ST 2084 (PQ) is applied to those absolute nits,
//! * the BT.2020 non-constant-luminance matrix quantizes the result into
//!   limited-range 10-bit codes (luma 64..940, chroma 64..960).
//!
//! The P010 destination is written through two plane views
//! (`CreateRenderTargetView1` with `R16_UNORM` for Y and `R16G16_UNORM` for
//! the interleaved UV plane — how D3D11 exposes the planes of a planar 4:2:0
//! surface), which is why the views come from `ID3D11Device3` and not from
//! the plain `CreateRenderTargetView`.
//!
//! Aspect-ratio bars are painted by drawing a 1x1 *black* scRGB source
//! through the same shaders over the whole target before the real frame goes
//! into the fitted viewport: black in scRGB comes out of this pipeline as
//! luma 64 / chroma 512, i.e. video-range black, which
//! `ClearRenderTargetView` on a plane view would not express.

use std::ffi::{c_void, CString};

use windows::core::{Interface, PCSTR};
use windows::Win32::Graphics::Direct3D::Fxc::{D3DCompile, D3DCOMPILE_OPTIMIZATION_LEVEL3};
use windows::Win32::Graphics::Direct3D::{ID3DBlob, D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST};
use windows::Win32::Graphics::Direct3D11::{
    ID3D11Device, ID3D11Device3, ID3D11DeviceContext, ID3D11PixelShader, ID3D11RenderTargetView,
    ID3D11RenderTargetView1, ID3D11SamplerState, ID3D11ShaderResourceView, ID3D11Texture2D,
    ID3D11VertexShader, D3D11_BIND_RENDER_TARGET, D3D11_BIND_SHADER_RESOURCE,
    D3D11_FILTER_MIN_MAG_MIP_LINEAR, D3D11_RENDER_TARGET_VIEW_DESC1,
    D3D11_RTV_DIMENSION_TEXTURE2DARRAY, D3D11_SAMPLER_DESC, D3D11_TEX2D_ARRAY_RTV1,
    D3D11_TEXTURE2D_DESC, D3D11_TEXTURE_ADDRESS_CLAMP, D3D11_USAGE_DEFAULT, D3D11_VIEWPORT,
};
use windows::Win32::Graphics::Dxgi::Common::{
    DXGI_FORMAT_P010, DXGI_FORMAT_R16_UNORM, DXGI_FORMAT_R16G16_UNORM,
    DXGI_FORMAT_R16G16B16A16_FLOAT, DXGI_SAMPLE_DESC,
};

use crate::capture::fit_rect;

/// Per-plane views of the P010 render target (Y at PlaneSlice 0, the
/// interleaved UV plane at PlaneSlice 1) plus the texture the encoder
/// registers. Two of these exist per converter: frame N+1 converts into the
/// other one while frame N's encode still reads its own.
struct PlaneTargets {
    texture: ID3D11Texture2D,
    y: ID3D11RenderTargetView,
    uv: ID3D11RenderTargetView,
}

/// HDR converter for one capture geometry (source size -> encoder size).
/// Lives and dies with the capture's D3D device, like the SDR scaler.
pub struct HdrConverter {
    context: ID3D11DeviceContext,
    vs: ID3D11VertexShader,
    ps_y: ID3D11PixelShader,
    ps_uv: ID3D11PixelShader,
    sampler: ID3D11SamplerState,
    /// FP16 copy of the duplication frame: the duplication texture itself is
    /// an SRV-able texture, but copying keeps the sampled surface independent
    /// of the duplication (and of its unmapped-on-release lifetime).
    staging: ID3D11Texture2D,
    staging_view: ID3D11ShaderResourceView,
    /// 1x1 scRGB black, drawn through the shaders to paint the bars.
    black_view: ID3D11ShaderResourceView,
    targets: Vec<PlaneTargets>,
    /// Fitted destination rectangle (letterbox) and its half-size chroma
    /// counterpart, plus the full-target viewports the bar pass uses.
    y_viewport: D3D11_VIEWPORT,
    uv_viewport: D3D11_VIEWPORT,
    full_y_viewport: D3D11_VIEWPORT,
    full_uv_viewport: D3D11_VIEWPORT,
}

unsafe impl Send for HdrConverter {}

impl HdrConverter {
    /// Compiles the shaders and allocates the conversion surfaces for
    /// `src_w`x`src_h` (the FP16 desktop) into `dst_w`x`dst_h` (the encoder
    /// size).
    pub fn new(
        device: &ID3D11Device,
        src_w: u32,
        src_h: u32,
        dst_w: u32,
        dst_h: u32,
    ) -> Result<Self, String> {
        unsafe {
            let context = device
                .GetImmediateContext()
                .map_err(|error| format!("GetImmediateContext: {error}"))?;
            let device3: ID3D11Device3 = device
                .cast()
                .map_err(|error| format!("ID3D11Device3: {error}"))?;

            let source = shader_source();
            let vs = create_vertex_shader(device, &compile(&source, "main_vs", "vs_5_0")?)?;
            let ps_y = create_pixel_shader(device, &compile(&source, "main_ps_y", "ps_5_0")?)?;
            let ps_uv = create_pixel_shader(device, &compile(&source, "main_ps_uv", "ps_5_0")?)?;

            // Linear filtering: the HDR scaler resamples in one pass (the
            // video processor is out of the picture), and for the half-size
            // chroma viewport sampling at the plane's own texel centres is
            // exactly the 4-tap box average of the luma texels they cover.
            let mut sampler_desc = D3D11_SAMPLER_DESC::default();
            sampler_desc.Filter = D3D11_FILTER_MIN_MAG_MIP_LINEAR;
            sampler_desc.AddressU = D3D11_TEXTURE_ADDRESS_CLAMP;
            sampler_desc.AddressV = D3D11_TEXTURE_ADDRESS_CLAMP;
            sampler_desc.AddressW = D3D11_TEXTURE_ADDRESS_CLAMP;
            sampler_desc.ComparisonFunc = windows::Win32::Graphics::Direct3D11::D3D11_COMPARISON_NEVER;
            sampler_desc.MaxLOD = f32::MAX;
            let mut sampler = None;
            device
                .CreateSamplerState(&sampler_desc, Some(&mut sampler))
                .map_err(|error| format!("CreateSamplerState: {error}"))?;

            let mut staging = None;
            let mut staging_desc = D3D11_TEXTURE2D_DESC::default();
            staging_desc.Width = src_w;
            staging_desc.Height = src_h;
            staging_desc.MipLevels = 1;
            staging_desc.ArraySize = 1;
            staging_desc.Format = DXGI_FORMAT_R16G16B16A16_FLOAT;
            staging_desc.SampleDesc = DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            };
            staging_desc.Usage = D3D11_USAGE_DEFAULT;
            staging_desc.BindFlags = D3D11_BIND_SHADER_RESOURCE.0 as u32;
            device
                .CreateTexture2D(&staging_desc, None, Some(&mut staging))
                .map_err(|error| format!("CreateTexture2D (staging): {error}"))?;
            let staging = staging.ok_or("CreateTexture2D returned no staging texture")?;
            let mut staging_view = None;
            device
                .CreateShaderResourceView(&staging, None, Some(&mut staging_view))
                .map_err(|error| format!("CreateShaderResourceView (staging): {error}"))?;

            // scRGB black: 4 half-floats of zero
            let black_pixels = [0u8; 8];
            let black_data = windows::Win32::Graphics::Direct3D11::D3D11_SUBRESOURCE_DATA {
                pSysMem: black_pixels.as_ptr() as *const c_void,
                SysMemPitch: 8,
                SysMemSlicePitch: 0,
            };
            let mut black_desc = staging_desc;
            black_desc.Width = 1;
            black_desc.Height = 1;
            let mut black = None;
            device
                .CreateTexture2D(&black_desc, Some(&black_data), Some(&mut black))
                .map_err(|error| format!("CreateTexture2D (black): {error}"))?;
            let black = black.ok_or("CreateTexture2D returned no black texture")?;
            let mut black_view = None;
            device
                .CreateShaderResourceView(&black, None, Some(&mut black_view))
                .map_err(|error| format!("CreateShaderResourceView (black): {error}"))?;

            let mut dest_desc = D3D11_TEXTURE2D_DESC::default();
            dest_desc.Width = dst_w;
            dest_desc.Height = dst_h;
            dest_desc.MipLevels = 1;
            dest_desc.ArraySize = 1;
            dest_desc.Format = DXGI_FORMAT_P010;
            dest_desc.SampleDesc = DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            };
            dest_desc.Usage = D3D11_USAGE_DEFAULT;
            dest_desc.BindFlags = D3D11_BIND_RENDER_TARGET.0 as u32;
            let mut targets = Vec::new();
            for slot in 0..2 {
                let mut texture = None;
                device
                    .CreateTexture2D(&dest_desc, None, Some(&mut texture))
                    .map_err(|error| format!("CreateTexture2D (slot {slot}): {error}"))?;
                let texture =
                    texture.ok_or_else(|| format!("CreateTexture2D returned no texture for slot {slot}"))?;
                let y = plane_view(&device3, &texture, DXGI_FORMAT_R16_UNORM, 0, slot)?;
                let uv = plane_view(&device3, &texture, DXGI_FORMAT_R16G16_UNORM, 1, slot)?;
                targets.push(PlaneTargets { texture, y, uv });
            }

            let (dx, dy, w, h) = fit_rect(src_w, src_h, dst_w, dst_h);
            let viewport = |x: f32, y: f32, w: f32, h: f32| D3D11_VIEWPORT {
                TopLeftX: x,
                TopLeftY: y,
                Width: w,
                Height: h,
                MinDepth: 0.0,
                MaxDepth: 1.0,
            };
            Ok(HdrConverter {
                context,
                vs,
                ps_y,
                ps_uv,
                sampler: sampler.ok_or("CreateSamplerState returned no sampler")?,
                staging,
                staging_view: staging_view.ok_or("no staging view")?,
                black_view: black_view.ok_or("no black view")?,
                targets,
                y_viewport: viewport(dx as f32, dy as f32, w as f32, h as f32),
                uv_viewport: viewport(
                    dx as f32 / 2.0,
                    dy as f32 / 2.0,
                    w as f32 / 2.0,
                    h as f32 / 2.0,
                ),
                full_y_viewport: viewport(0.0, 0.0, dst_w as f32, dst_h as f32),
                full_uv_viewport: viewport(0.0, 0.0, dst_w as f32 / 2.0, dst_h as f32 / 2.0),
            })
        }
    }

    /// Converts `source` (an FP16 scRGB duplication frame of the size this
    /// converter was built for) into the P010 texture of `slot`, which the
    /// caller hands to the encoder. The returned texture stays owned by the
    /// converter; the caller must not convert into the same slot again until
    /// that slot's previous encode has been reaped.
    pub fn convert(
        &self,
        source: &ID3D11Texture2D,
        slot: usize,
    ) -> Result<ID3D11Texture2D, String> {
        let targets = self
            .targets
            .get(slot)
            .ok_or_else(|| format!("no HDR target for slot {slot}"))?;
        self.check_source(source)?;
        unsafe {
            self.context.CopyResource(&self.staging, source);
            // Bars first: scRGB black through this pipeline is video-range
            // black, which is what the letterboxed region must be.
            self.draw(&self.black_view, &targets.y, self.full_y_viewport, false);
            self.draw(&self.black_view, &targets.uv, self.full_uv_viewport, true);
            self.draw(&self.staging_view, &targets.y, self.y_viewport, false);
            self.draw(&self.staging_view, &targets.uv, self.uv_viewport, true);
            // NVENC maps this texture on the same device: nothing may still
            // be bound for write (or as an SRV) when it does.
            self.context.OMSetRenderTargets(None, None);
            self.context
                .PSSetShaderResources(0, Some(&[None::<ID3D11ShaderResourceView>]));
            Ok(targets.texture.clone())
        }
    }

    /// The encoder-side size this converter produces.
    pub fn target_size(&self) -> (u32, u32) {
        (
            self.full_y_viewport.Width as u32,
            self.full_y_viewport.Height as u32,
        )
    }

    /// `CopyResource` reports format/size mismatches by doing nothing at all
    /// (it returns `()`), so a wrong source would silently encode the
    /// previous frame's content forever. Check the shape that makes the copy
    /// legal instead.
    fn check_source(&self, source: &ID3D11Texture2D) -> Result<(), String> {
        let (mut want, mut got) = (D3D11_TEXTURE2D_DESC::default(), D3D11_TEXTURE2D_DESC::default());
        unsafe {
            self.staging.GetDesc(&mut want);
            source.GetDesc(&mut got);
        }
        if want.Width != got.Width
            || want.Height != got.Height
            || want.Format != got.Format
            || want.ArraySize != got.ArraySize
        {
            return Err(format!(
                "HDR conversion source mismatch: want {}x{} format {} array {}, got {}x{} format {} \
                 array {}",
                want.Width, want.Height, want.Format.0, want.ArraySize, got.Width, got.Height,
                got.Format.0, got.ArraySize
            ));
        }
        Ok(())
    }

    /// One fullscreen-triangle pass into one plane view. `uv` selects the
    /// chroma pixel shader — the two plane views differ only in format, and
    /// asking the view would need the `...1` interface back again.
    unsafe fn draw(
        &self,
        source: &ID3D11ShaderResourceView,
        target: &ID3D11RenderTargetView,
        viewport: D3D11_VIEWPORT,
        uv: bool,
    ) {
        self.context
            .OMSetRenderTargets(Some(&[Some(target.clone())]), None);
        self.context.RSSetViewports(Some(&[viewport]));
        self.context
            .IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
        self.context.VSSetShader(&self.vs, None);
        let ps = if uv { &self.ps_uv } else { &self.ps_y };
        self.context.PSSetShader(ps, None);
        self.context
            .VSSetSamplers(0, Some(&[Some(self.sampler.clone())]));
        self.context
            .PSSetSamplers(0, Some(&[Some(self.sampler.clone())]));
        self.context
            .PSSetShaderResources(0, Some(&[Some(source.clone())]));
        self.context.Draw(3, 0);
    }
}

/// Creates a plane render-target view of a P010 texture: `format` is
/// `R16_UNORM` for the luma plane (`plane` 0) and `R16G16_UNORM` for the
/// interleaved chroma plane (`plane` 1). D3D11 exposes planar surfaces this
/// way and only through the `...1` view/interface pair.
unsafe fn plane_view(
    device: &ID3D11Device3,
    texture: &ID3D11Texture2D,
    format: windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT,
    plane: u32,
    slot: usize,
) -> Result<ID3D11RenderTargetView, String> {
    let mut desc = D3D11_RENDER_TARGET_VIEW_DESC1::default();
    desc.Format = format;
    desc.ViewDimension = D3D11_RTV_DIMENSION_TEXTURE2DARRAY;
    desc.Anonymous.Texture2DArray = D3D11_TEX2D_ARRAY_RTV1 {
        MipSlice: 0,
        FirstArraySlice: 0,
        ArraySize: 1,
        PlaneSlice: plane,
    };
    let mut view: Option<ID3D11RenderTargetView1> = None;
    device
        .CreateRenderTargetView1(texture, Some(&desc), Some(&mut view))
        .map_err(|error| format!("CreateRenderTargetView1 (plane {plane}, slot {slot}): {error}"))?;
    let view = view.ok_or("CreateRenderTargetView1 returned no view")?;
    view.cast::<ID3D11RenderTargetView>()
        .map_err(|error| format!("ID3D11RenderTargetView: {error}"))
}

/// Creates the vertex shader from compiled bytecode.
unsafe fn create_vertex_shader(
    device: &ID3D11Device,
    bytes: &[u8],
) -> Result<ID3D11VertexShader, String> {
    let mut shader = None;
    device
        .CreateVertexShader(bytes, None, Some(&mut shader))
        .map_err(|error| format!("CreateVertexShader: {error}"))?;
    shader.ok_or_else(|| "CreateVertexShader returned no shader".to_string())
}

/// Creates a pixel shader from compiled bytecode.
unsafe fn create_pixel_shader(
    device: &ID3D11Device,
    bytes: &[u8],
) -> Result<ID3D11PixelShader, String> {
    let mut shader = None;
    device
        .CreatePixelShader(bytes, None, Some(&mut shader))
        .map_err(|error| format!("CreatePixelShader: {error}"))?;
    shader.ok_or_else(|| "CreatePixelShader returned no shader".to_string())
}

/// `D3DCompile` with the error blob surfaced as text (the default failure is
/// just an HRESULT, which says nothing about the shader).
unsafe fn compile(source: &str, entry: &str, target: &str) -> Result<Vec<u8>, String> {
    let entry = CString::new(entry).map_err(|error| error.to_string())?;
    let target = CString::new(target).map_err(|error| error.to_string())?;
    let mut blob: Option<ID3DBlob> = None;
    let mut errors: Option<ID3DBlob> = None;
    let result = D3DCompile(
        source.as_ptr() as *const c_void,
        source.len(),
        PCSTR::null(),
        None,
        None,
        PCSTR(entry.as_ptr() as *const u8),
        PCSTR(target.as_ptr() as *const u8),
        D3DCOMPILE_OPTIMIZATION_LEVEL3,
        0,
        &mut blob,
        Some(&mut errors),
    );
    if let Err(error) = result {
        let text = errors.map(|blob| blob_text(&blob)).unwrap_or_default();
        return Err(format!("D3DCompile ({entry:?}): {error}: {text}"));
    }
    let blob = blob.ok_or("D3DCompile returned no bytecode")?;
    Ok(std::slice::from_raw_parts(
        blob.GetBufferPointer() as *const u8,
        blob.GetBufferSize(),
    )
    .to_vec())
}

/// Text of an `ID3DBlob` holding compiler diagnostics.
unsafe fn blob_text(blob: &ID3DBlob) -> String {
    let size = blob.GetBufferSize();
    if size == 0 {
        return String::new();
    }
    let bytes = std::slice::from_raw_parts(blob.GetBufferPointer() as *const u8, size);
    let end = bytes.iter().position(|byte| *byte == 0).unwrap_or(bytes.len());
    String::from_utf8_lossy(&bytes[..end]).into_owned()
}

/// The Y/Cb/Cr vectors for BT.2020 non-constant luminance, limited range,
/// 10-bit — ITU-T H.273 §8.3 through Sunshine's
/// `color_vectors_from_colorspace` (`video_colorspace.cpp:140-206`) with
/// `unorm_output = true`, i.e. every entry already divided by 1023 so a
/// shader value of 1.0 is code 1023 on the P010 plane view.
///
/// The chroma rows are built so a neutral (R == G == B) colour lands on
/// `uv_add` exactly, which is what the hardware probe asserts.
pub fn color_vectors_bt2020_limited_10bit() -> [[f32; 4]; 3] {
    const BIT_DEPTH: u32 = 10;
    const KR: f64 = 0.2627;
    const KB: f64 = 0.0593;
    let kg = 1.0 - KR - KB;
    let unorm_range = ((1u32 << BIT_DEPTH) - 1) as f64;
    let y_mult = ((1u32 << (BIT_DEPTH - 8)) * 219) as f64 / unorm_range;
    let y_add = ((1u32 << (BIT_DEPTH - 8)) * 16) as f64 / unorm_range;
    let uv_mult = ((1u32 << (BIT_DEPTH - 8)) * 224) as f64 / unorm_range;
    let uv_add = ((1u32 << (BIT_DEPTH - 8)) * 128) as f64 / unorm_range;
    [
        [
            (KR * y_mult) as f32,
            (kg * y_mult) as f32,
            (KB * y_mult) as f32,
            y_add as f32,
        ],
        [
            (-0.5 * KR / (1.0 - KB) * uv_mult) as f32,
            (-0.5 * kg / (1.0 - KB) * uv_mult) as f32,
            (0.5 * uv_mult) as f32,
            uv_add as f32,
        ],
        [
            (0.5 * uv_mult) as f32,
            (-0.5 * kg / (1.0 - KR) * uv_mult) as f32,
            (-0.5 * KB / (1.0 - KR) * uv_mult) as f32,
            uv_add as f32,
        ],
    ]
}

/// The complete shader: `main_vs` (fullscreen triangle), `main_ps_y` and
/// `main_ps_uv`. The colour vectors are generated from the Rust computation
/// above so the shader and the unit tests cannot drift apart.
pub fn shader_source() -> String {
    let [y, u, v] = color_vectors_bt2020_limited_10bit();
    let vec4 = |name: &str, values: [f32; 4]| {
        format!(
            "static const float4 {name} = float4({:.9}, {:.9}, {:.9}, {:.9});\n",
            values[0], values[1], values[2], values[3]
        )
    };
    let mut header = String::new();
    header.push_str(&vec4("color_vec_y", y));
    header.push_str(&vec4("color_vec_u", u));
    header.push_str(&vec4("color_vec_v", v));
    header.push_str(SHADER_BODY);
    header
}

/// The shader body around the generated constants. Kept as a separate
/// literal so the Rust `format!` never has to escape HLSL braces.
const SHADER_BODY: &str = r#"
Texture2D image : register(t0);
SamplerState def_sampler : register(s0);

// Fullscreen triangle: one triangle that covers the whole viewport whatever
// its size, with texture coordinates running 0..1 across that viewport (so
// the letterboxed viewport maps the source into the fitted rectangle).
float4 main_vs(uint id : SV_VertexID, out float2 tex : TEXCOORD0) : SV_Position
{
    float2 coord;
    float4 position;
    if (id == 0) {
        position = float4(-1.0, -1.0, 0.0, 1.0);
        coord = float2(0.0, 1.0);
    } else if (id == 1) {
        position = float4(-1.0, 3.0, 0.0, 1.0);
        coord = float2(0.0, -1.0);
    } else {
        position = float4(3.0, -1.0, 0.0, 1.0);
        coord = float2(2.0, 1.0);
    }
    tex = coord;
    return position;
}

// SMPTE ST 2084 (PQ), Sunshine's NitsToPQ.
float3 NitsToPQ(float3 luminance)
{
    static const float m1 = 2610.0 / 4096.0 / 4.0;
    static const float m2 = 2523.0 / 4096.0 * 128.0;
    static const float c1 = 3424.0 / 4096.0;
    static const float c2 = 2413.0 / 4096.0 * 32.0;
    static const float c3 = 2392.0 / 4096.0 * 32.0;
    float3 lp = pow(saturate(luminance / 10000.0), m1);
    return pow((c1 + c2 * lp) / (1.0 + c3 * lp), m2);
}

// scRGB (linear, Rec.709 primaries, 1.0 == 80 nits) to Rec.2100 PQ.
float3 scRGBTo2100PQ(float3 rgb)
{
    static const float3x3 rec709_to_rec2020 = {
        0.627402, 0.329292, 0.043306,
        0.069095, 0.919544, 0.011360,
        0.016394, 0.088028, 0.895578
    };
    rgb = mul(rec709_to_rec2020, rgb);
    return NitsToPQ(rgb * 80.0);
}

float main_ps_y(float4 position : SV_Position, float2 tex : TEXCOORD0) : SV_Target
{
    float3 rgb = scRGBTo2100PQ(image.Sample(def_sampler, tex).rgb);
    return dot(color_vec_y.xyz, rgb) + color_vec_y.w;
}

float2 main_ps_uv(float4 position : SV_Position, float2 tex : TEXCOORD0) : SV_Target
{
    float3 rgb = scRGBTo2100PQ(image.Sample(def_sampler, tex).rgb);
    float2 uv;
    uv.x = dot(color_vec_u.xyz, rgb) + color_vec_u.w;
    uv.y = dot(color_vec_v.xyz, rgb) + color_vec_v.w;
    return uv;
}
"#;

#[cfg(test)]
mod tests {
    use super::*;

    /// The vectors must be exactly the H.273 BT.2020 limited-range 10-bit
    /// ones, and they must be neutral-preserving: a grey sample has to land
    /// on 512/1023 for both chroma planes and on 64/1023 for black.
    #[test]
    fn bt2020_limited_vectors_are_neutral_preserving() {
        let [y, u, v] = color_vectors_bt2020_limited_10bit();
        assert!((y[0] + y[1] + y[2] - 876.0 / 1023.0).abs() < 1e-6);
        assert!((y[3] - 64.0 / 1023.0).abs() < 1e-6);
        // grey: chroma sums to zero before the offset
        assert!((u[0] + u[1] + u[2]).abs() < 1e-6);
        assert!((v[0] + v[1] + v[2]).abs() < 1e-6);
        assert!((u[3] - 512.0 / 1023.0).abs() < 1e-6);
        assert!((v[3] - 512.0 / 1023.0).abs() < 1e-6);
        // luma weights are the Rec.2020 ones, in the Y row
        let weight = |index: usize| y[index] / (876.0 / 1023.0);
        assert!((weight(0) - 0.2627).abs() < 1e-6);
        assert!((weight(1) - 0.6780).abs() < 1e-6);
        assert!((weight(2) - 0.0593).abs() < 1e-6);
    }

    /// The generated HLSL must carry the computed vectors, and the PQ/Rec.2020
    /// constants must be the ST 2084 / Sunshine ones.
    #[test]
    fn shader_source_bakes_the_vectors() {
        let source = shader_source();
        let [y, _, _] = color_vectors_bt2020_limited_10bit();
        assert!(source.contains(&format!("{:.9}", y[0])), "{source}");
        assert!(source.contains("2610.0 / 4096.0 / 4.0"));
        assert!(source.contains("0.627402"));
        assert!(source.contains("main_ps_y") && source.contains("main_ps_uv"));
        // every brace in the body must have survived: an unbalanced shader
        // would only fail at D3DCompile time, on the GPU path
        assert_eq!(
            source.matches('{').count(),
            source.matches('}').count(),
            "unbalanced HLSL braces"
        );
    }

    /// Hardware probe (run with `--ignored`): render known scRGB values
    /// through the conversion and read the 10-bit codes back out of the P010
    /// surface. The anchors are computed from the standard rather than from
    /// the shader: scRGB black is video-range black (64/512), 1.0 is 80 nits
    /// and lands near code 490 after ST 2084, and 10000 nits (scRGB 125.0)
    /// is the top of the PQ curve, code 940.
    #[test]
    #[ignore]
    fn probe_hdr_conversion_codes() {
        use std::ptr;

        use windows::Win32::Foundation::HMODULE;
        use windows::Win32::Graphics::Direct3D::{
            D3D_DRIVER_TYPE_HARDWARE, D3D_FEATURE_LEVEL_11_0,
        };
        use windows::Win32::Graphics::Direct3D11::{
            D3D11CreateDevice, D3D11_CPU_ACCESS_READ, D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            D3D11_MAPPED_SUBRESOURCE, D3D11_MAP_READ, D3D11_SDK_VERSION, D3D11_SUBRESOURCE_DATA,
            D3D11_USAGE_STAGING,
        };

        /// half-float bit patterns the test paints with
        const H0: u16 = 0x0000; // 0.0
        const H1: u16 = 0x3c00; // 1.0  = 80 nits
        const H125: u16 = 0x57d0; // 125.0 = 10000 nits

        unsafe {
            let mut device: Option<ID3D11Device> = None;
            let mut context: Option<ID3D11DeviceContext> = None;
            D3D11CreateDevice(
                None,
                D3D_DRIVER_TYPE_HARDWARE,
                HMODULE(ptr::null_mut()),
                D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                Some(&[D3D_FEATURE_LEVEL_11_0]),
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                Some(&mut context),
            )
            .expect("D3D11CreateDevice");
            let device = device.expect("device");
            let context = context.expect("context");

            let make_source = |w: u32, h: u32, rgb: [u16; 3]| {
                let mut desc = D3D11_TEXTURE2D_DESC::default();
                desc.Width = w;
                desc.Height = h;
                desc.MipLevels = 1;
                desc.ArraySize = 1;
                desc.Format = DXGI_FORMAT_R16G16B16A16_FLOAT;
                desc.SampleDesc = DXGI_SAMPLE_DESC {
                    Count: 1,
                    Quality: 0,
                };
                desc.Usage = D3D11_USAGE_DEFAULT;
                let mut pixels = Vec::with_capacity((w * h * 4) as usize);
                for _ in 0..w * h {
                    pixels.extend_from_slice(&[rgb[0], rgb[1], rgb[2], H1]);
                }
                let data = D3D11_SUBRESOURCE_DATA {
                    pSysMem: pixels.as_ptr() as *const c_void,
                    SysMemPitch: w * 8,
                    SysMemSlicePitch: 0,
                };
                let mut texture: Option<ID3D11Texture2D> = None;
                device
                    .CreateTexture2D(&desc, Some(&data), Some(&mut texture))
                    .expect("source texture");
                texture.expect("source")
            };

            // Reads the whole surface back: (row pitch, luma words, chroma
            // words) — P010 stores the interleaved UV plane right after the
            // luma plane.
            let read_back = |texture: &ID3D11Texture2D| {
                let mut desc = D3D11_TEXTURE2D_DESC::default();
                texture.GetDesc(&mut desc);
                let mut staging = desc;
                staging.Usage = D3D11_USAGE_STAGING;
                staging.BindFlags = 0;
                staging.CPUAccessFlags = D3D11_CPU_ACCESS_READ.0 as u32;
                staging.MiscFlags = 0;
                let mut copy: Option<ID3D11Texture2D> = None;
                device
                    .CreateTexture2D(&staging, None, Some(&mut copy))
                    .expect("staging texture");
                let copy = copy.expect("staging");
                context.CopyResource(&copy, texture);
                let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
                context
                    .Map(&copy, 0, D3D11_MAP_READ, 0, Some(&mut mapped))
                    .expect("map");
                let pitch = mapped.RowPitch as usize;
                let words = pitch * desc.Height as usize;
                let bytes = std::slice::from_raw_parts(mapped.pData as *const u8, words * 2);
                let all: Vec<u16> = bytes
                    .chunks_exact(2)
                    .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
                    .collect();
                context.Unmap(&copy, 0);
                (pitch, all, desc.Height as usize)
            };

            let converter = HdrConverter::new(&device, 16, 16, 16, 16).expect("converter");
            // Code values at luma (x, y) and at the matching 4:2:0 chroma
            // position.
            let codes = |converter: &HdrConverter, rgb: [u16; 3], x: usize, y: usize| {
                let source = make_source(16, 16, rgb);
                let target = converter.convert(&source, 0).expect("convert");
                let (pitch, words, height) = read_back(&target);
                let row = pitch / 2;
                let chroma = ((height + y / 2) * row) + (x / 2) * 2;
                (
                    (words[y * row + x] >> 6) as u32,
                    (words[chroma] >> 6) as u32,
                    (words[chroma + 1] >> 6) as u32,
                )
            };

            let black = codes(&converter, [H0, H0, H0], 8, 8);
            let white = codes(&converter, [H1, H1, H1], 8, 8);
            let peak = codes(&converter, [H125, H125, H125], 8, 8);
            let red = codes(&converter, [H1, H0, H0], 8, 8);
            eprintln!("scRGB black -> Y/U/V {black:?}");
            eprintln!("scRGB 1.0 (80 nits) -> Y/U/V {white:?}");
            eprintln!("scRGB 125.0 (10000 nits) -> Y/U/V {peak:?}");
            eprintln!("scRGB red 1.0 -> Y/U/V {red:?}");

            assert_eq!(black, (64, 512, 512), "black must be video-range black");
            assert!(
                (489..=492).contains(&white.0),
                "80 nits should land near code 490, got {white:?}"
            );
            assert_eq!((white.1, white.2), (512, 512), "grey must stay neutral");
            assert!(
                (938..=941).contains(&peak.0),
                "10000 nits is the top of the PQ curve, got {peak:?}"
            );
            assert!(
                red.1 < 512 && red.2 > 512,
                "red must push chroma off neutral, got {red:?}"
            );

            // Aspect mismatch: 16x16 into 16x8 letterboxes to 8x8 centred, so
            // the bars in the same luma row must be black and the frame area
            // must carry the picture.
            let letterbox = HdrConverter::new(&device, 16, 16, 16, 8).expect("letterbox converter");
            let bar = codes(&letterbox, [H1, H1, H1], 0, 4);
            let picture = codes(&letterbox, [H1, H1, H1], 8, 4);
            eprintln!("letterbox bar -> {bar:?}, picture -> {picture:?}");
            assert_eq!(bar.0, 64, "letterbox bar must be black");
            assert!(
                (489..=492).contains(&picture.0),
                "letterbox picture must be the frame, got {picture:?}"
            );
        }
    }
}
