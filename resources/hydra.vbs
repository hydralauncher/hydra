Set WshShell = CreateObject("WScript.Shell" ) 
WshShell.Run """%localappdata%\Programs\Hydra\Hydra.exe""", 0 'Must quote command if it has spaces; must escape quotes
Set WshShell = Nothing