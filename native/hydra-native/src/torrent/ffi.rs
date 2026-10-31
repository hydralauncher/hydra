//! The only unsafe boundary. Objects never leave the native control thread.
use std::ffi::{c_char, c_void, CStr, CString};
use std::ptr;

type Raw = *mut c_void;
pub type Result<T> = std::result::Result<T, String>;
#[repr(C)]
#[derive(Default)]
pub struct Status {
    pub wanted: i64,
    pub done: i64,
    pub downloaded: i64,
    pub progress: f64,
    pub download_rate: i32,
    pub upload_rate: i32,
    pub peers: i32,
    pub seeds: i32,
    pub state: i32,
    pub metadata: i32,
}
#[link(name = "hydra_torrent_bridge")]
extern "C" {
    fn ht_error() -> *mut c_char;
    fn ht_string_free(p: *mut c_char);
    fn ht_session_new(port: u16, out: *mut Raw) -> i32;
    fn ht_session_free(p: Raw);
    fn ht_settings(p: Raw, limit: i32, listen: *const c_char, outgoing: *const c_char) -> i32;
    fn ht_prepare(
        magnet: *const c_char,
        path: *const c_char,
        seed: i32,
        selective: i32,
        out: *mut Raw,
    ) -> i32;
    fn ht_params_free(p: Raw);
    fn ht_tracker_count(p: Raw, count: *mut i32) -> i32;
    fn ht_tracker_get(p: Raw, index: i32, url: *mut *mut c_char, tier: *mut i32) -> i32;
    fn ht_tracker_append(p: Raw, url: *const c_char, tier: i32) -> i32;
    fn ht_add(s: Raw, p: Raw, out: *mut Raw) -> i32;
    fn ht_handle_free(p: Raw);
    fn ht_equal(a: Raw, b: Raw, equal: *mut i32) -> i32;
    fn ht_remove(s: Raw, h: Raw, part: i32) -> i32;
    fn ht_pause(h: Raw) -> i32;
    fn ht_resume(h: Raw) -> i32;
    fn ht_download_mode(h: Raw, selective: i32) -> i32;
    fn ht_add_tracker(h: Raw, url: *const c_char) -> i32;
    fn ht_get_status(h: Raw, out: *mut Status) -> i32;
    fn ht_info(h: Raw, name: *mut *mut c_char, size: *mut i64, count: *mut i32) -> i32;
    fn ht_file(h: Raw, index: i32, path: *mut *mut c_char, size: *mut i64) -> i32;
    fn ht_priorities(h: Raw, p: *const u8, count: i32) -> i32;
    fn ht_priorities_match(h: Raw, p: *const u8, count: i32, matches: *mut i32) -> i32;
}
fn text(s: &str) -> Result<CString> {
    CString::new(s).map_err(|_| "invalid_params".into())
}
unsafe fn take_string(p: *mut c_char) -> String {
    if p.is_null() {
        return "internal_error".into();
    }
    let result = CStr::from_ptr(p).to_string_lossy().into_owned();
    ht_string_free(p);
    result
}
fn check(code: i32) -> Result<()> {
    if code == 0 {
        return Ok(());
    }
    let message = unsafe { take_string(ht_error()) };
    match message.as_str() {
        "invalid_magnet" | "metadata_incomplete" | "invalid_file_indices" => Err(message),
        _ => {
            eprintln!("libtorrent: {message}");
            Err("internal_error".into())
        }
    }
}
pub struct Session(Raw);
pub struct Params(Raw);
pub struct Handle(Raw);
impl Drop for Session {
    fn drop(&mut self) {
        unsafe { ht_session_free(self.0) }
    }
}
impl Drop for Params {
    fn drop(&mut self) {
        unsafe { ht_params_free(self.0) }
    }
}
impl Drop for Handle {
    fn drop(&mut self) {
        unsafe { ht_handle_free(self.0) }
    }
}
impl Session {
    pub fn new(port: u16) -> Result<Self> {
        let mut p = ptr::null_mut();
        unsafe {
            check(ht_session_new(port, &mut p))?;
        }
        Ok(Self(p))
    }
    pub fn limit(&self, limit: i32) -> Result<()> {
        unsafe { check(ht_settings(self.0, limit, ptr::null(), ptr::null())) }
    }
    pub fn bind(&self, listen: &str, outgoing: &str) -> Result<()> {
        let (l, o) = (text(listen)?, text(outgoing)?);
        unsafe { check(ht_settings(self.0, -1, l.as_ptr(), o.as_ptr())) }
    }
    pub fn add(&self, params: &Params) -> Result<Handle> {
        let mut p = ptr::null_mut();
        unsafe {
            check(ht_add(self.0, params.0, &mut p))?;
        }
        Ok(Handle(p))
    }
    pub fn remove(&self, handle: &Handle, part: bool) -> Result<()> {
        unsafe { check(ht_remove(self.0, handle.0, part as i32)) }
    }
}
impl Params {
    pub fn new(magnet: &str, path: &str, seed: bool, selective: bool) -> Result<Self> {
        let m = text(magnet).map_err(|_| "invalid_magnet")?;
        let p = text(path).map_err(|_| "invalid_save_path")?;
        let mut out = ptr::null_mut();
        unsafe {
            check(ht_prepare(
                m.as_ptr(),
                p.as_ptr(),
                seed as i32,
                selective as i32,
                &mut out,
            ))?;
        }
        Ok(Self(out))
    }
    pub fn trackers(&self) -> Result<Vec<(String, i32)>> {
        let mut count = 0;
        unsafe {
            check(ht_tracker_count(self.0, &mut count))?;
        }
        let mut result = Vec::new();
        for i in 0..count {
            let (mut url, mut tier) = (ptr::null_mut(), 0);
            unsafe {
                check(ht_tracker_get(self.0, i, &mut url, &mut tier))?;
                result.push((take_string(url), tier));
            }
        }
        Ok(result)
    }
    pub fn append_tracker(&self, url: &str, tier: i32) -> Result<()> {
        let url = text(url)?;
        unsafe { check(ht_tracker_append(self.0, url.as_ptr(), tier)) }
    }
}
impl Handle {
    pub fn download_mode(&self, selective: bool) -> Result<()> {
        unsafe { check(ht_download_mode(self.0, selective as i32)) }
    }
    pub fn same(&self, other: &Self) -> Result<bool> {
        let mut equal = 0;
        unsafe {
            check(ht_equal(self.0, other.0, &mut equal))?;
        }
        Ok(equal != 0)
    }
    pub fn pause(&self) -> Result<()> {
        unsafe { check(ht_pause(self.0)) }
    }
    pub fn resume(&self) -> Result<()> {
        unsafe { check(ht_resume(self.0)) }
    }
    pub fn add_tracker(&self, url: &str) -> Result<()> {
        let u = text(url)?;
        unsafe { check(ht_add_tracker(self.0, u.as_ptr())) }
    }
    pub fn status(&self) -> Result<Status> {
        let mut s = Status::default();
        unsafe {
            check(ht_get_status(self.0, &mut s))?;
        }
        Ok(s)
    }
    pub fn info(&self) -> Result<(String, i64, i32)> {
        let (mut name, mut size, mut count) = (ptr::null_mut(), 0, 0);
        unsafe {
            check(ht_info(self.0, &mut name, &mut size, &mut count))?;
            Ok((take_string(name), size, count))
        }
    }
    pub fn file(&self, index: i32) -> Result<(String, i64)> {
        let (mut path, mut size) = (ptr::null_mut(), 0);
        unsafe {
            check(ht_file(self.0, index, &mut path, &mut size))?;
            Ok((take_string(path), size))
        }
    }
    pub fn prioritize(&self, priorities: &[u8]) -> Result<()> {
        unsafe {
            check(ht_priorities(
                self.0,
                priorities.as_ptr(),
                priorities.len() as i32,
            ))
        }
    }
    pub fn priorities_match(&self, priorities: &[u8]) -> Result<bool> {
        let mut matches = 0;
        unsafe {
            check(ht_priorities_match(
                self.0,
                priorities.as_ptr(),
                priorities.len() as i32,
                &mut matches,
            ))?;
        }
        Ok(matches != 0)
    }
}
