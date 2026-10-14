use epic_prerequisite_runner::{
    invalid, quote_argument, quote_msi_argument, Config, Kind, MAX_COMMAND_UNITS,
};
use std::{io, mem, path::Path, ptr};
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0},
    System::{
        JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectBasicAccountingInformation,
            JobObjectExtendedLimitInformation, QueryInformationJobObject, SetInformationJobObject,
            JOBOBJECT_BASIC_ACCOUNTING_INFORMATION, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        },
        SystemInformation::GetSystemDirectoryW,
        Threading::{
            CreateProcessW, GetExitCodeProcess, ResumeThread, Sleep, TerminateProcess,
            WaitForSingleObject, CREATE_SUSPENDED, INFINITE, PROCESS_INFORMATION, STARTUPINFOW,
        },
    },
};
const JOB_POLL_INTERVAL_MS: u32 = 25;
struct Handle(HANDLE);
impl Drop for Handle {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}
pub fn execute(config: &Config) -> io::Result<u32> {
    if (!matches!(config.kind, Kind::Reboot)
        && (!Path::new(&config.executable).is_absolute()
            || !std::fs::metadata(&config.executable)?.is_file()))
        || !Path::new(&config.cwd).is_absolute()
        || !Path::new(&config.result_path).is_absolute()
        || !std::fs::metadata(&config.cwd)?.is_dir()
    {
        return Err(invalid());
    }
    let (executable, args) = match config.kind {
        Kind::Exe => (config.executable.clone(), config.args.clone()),
        Kind::Msi | Kind::Reboot => {
            let mut directory = vec![0u16; MAX_COMMAND_UNITS + 1];
            let length =
                unsafe { GetSystemDirectoryW(directory.as_mut_ptr(), directory.len() as u32) };
            if length == 0 || length as usize >= directory.len() {
                return Err(io::Error::last_os_error());
            }
            let system =
                String::from_utf16(&directory[..length as usize]).map_err(|_| invalid())?;
            if matches!(config.kind, Kind::Reboot) {
                (format!("{}\\wineboot.exe", system), vec!["-r".into()])
            } else {
                let mut args = vec!["/i".into(), config.executable.clone()];
                args.extend(config.args.clone());
                (format!("{}\\msiexec.exe", system), args)
            }
        }
    };
    let executable_wide = wide(&executable);
    let cwd = wide(&config.cwd);
    let mut words = vec![quote_argument(&executable)];
    words.extend(args.iter().map(|argument| {
        if matches!(config.kind, Kind::Msi) {
            quote_msi_argument(argument)
        } else {
            quote_argument(argument)
        }
    }));
    let command = words.join(" ");
    let mut command = wide(&command);
    if command.len() > MAX_COMMAND_UNITS {
        return Err(invalid());
    }
    unsafe {
        // Suspend and assign before descendants can run. Closing this job kills its tree.
        let job = Handle(CreateJobObjectW(ptr::null(), ptr::null()));
        if job.0.is_null() {
            return Err(io::Error::last_os_error());
        }
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = mem::zeroed();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if SetInformationJobObject(
            job.0,
            JobObjectExtendedLimitInformation,
            &limits as *const _ as *const _,
            mem::size_of_val(&limits) as u32,
        ) == 0
        {
            return Err(io::Error::last_os_error());
        }
        let mut startup: STARTUPINFOW = mem::zeroed();
        startup.cb = mem::size_of_val(&startup) as u32;
        let mut process: PROCESS_INFORMATION = mem::zeroed();
        if CreateProcessW(
            executable_wide.as_ptr(),
            command.as_mut_ptr(),
            ptr::null(),
            ptr::null(),
            0,
            CREATE_SUSPENDED,
            ptr::null(),
            cwd.as_ptr(),
            &startup,
            &mut process,
        ) == 0
        {
            return Err(io::Error::last_os_error());
        }
        let root = Handle(process.hProcess);
        let thread = Handle(process.hThread);
        if AssignProcessToJobObject(job.0, root.0) == 0 {
            let error = io::Error::last_os_error();
            TerminateProcess(root.0, 1);
            WaitForSingleObject(root.0, INFINITE);
            return Err(error);
        }
        if ResumeThread(thread.0) == u32::MAX {
            return Err(io::Error::last_os_error());
        }
        if WaitForSingleObject(root.0, INFINITE) != WAIT_OBJECT_0 {
            return Err(io::Error::last_os_error());
        }
        let mut code = 0;
        if GetExitCodeProcess(root.0, &mut code) == 0 {
            return Err(io::Error::last_os_error());
        }
        loop {
            let mut accounting: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = mem::zeroed();
            if QueryInformationJobObject(
                job.0,
                JobObjectBasicAccountingInformation,
                &mut accounting as *mut _ as *mut _,
                mem::size_of_val(&accounting) as u32,
                ptr::null_mut(),
            ) == 0
            {
                return Err(io::Error::last_os_error());
            }
            if accounting.ActiveProcesses == 0 {
                break;
            }
            Sleep(JOB_POLL_INTERVAL_MS);
        }
        Ok(code)
    }
}
