@echo off
:: Request admin privileges if not already elevated
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Requesting administrative privileges...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit
)

:: Change to the script’s directory
cd /d "%~dp0"

echo Installing prerequisites silently...

:: Install .NET Framework 4.0
if exist dotNetFx40_Full_setup.exe dotNetFx40_Full_setup.exe /q /norestart /log dotnet_install.log

:: Install DirectX
if exist dxwebsetup.exe dxwebsetup.exe /Q

:: Install OpenAL
if exist oalinst.exe oalinst.exe /silent

:: Install Visual C++ Redistributables (2015-2019)
if exist vcredist_2015-2019_x64.exe vcredist_2015-2019_x64.exe /quiet /norestart
if exist vcredist_2015-2019_x86.exe vcredist_2015-2019_x86.exe /quiet /norestart

:: Install older Visual C++ Redistributables
if exist vcredist_x64.exe vcredist_x64.exe /quiet /norestart
if exist vcredist_x86.exe vcredist_x86.exe /quiet /norestart

:: Install XNA Framework 4.0
if exist xnafx40_redist.msi msiexec /i xnafx40_redist.msi /quiet /norestart

echo Installation complete!
pause