# Hydra Launcher Linux OnlineFix Support

This fork adds Linux support for games using SteamFix / OnlineFix through UMU + Proton.

## Problem

OnlineFix games failed on Linux with:

Failed to load original steam client error 126

Hydra normally launches games using a normal UMU prefix.

OnlineFix requires:

- Steam AppID 480 (Spacewar)
- SteamFix Wine prefix
- DLL overrides

## Solution

When Hydra detects:

- OnlineFix64.dll
- OnlineFix.ini

it launches using:

GAMEID=480

SteamAppId=480

WINEPREFIX=~/SteamPrefixes/480

WINEDLLOVERRIDES=OnlineFix64=n

## Tested

- Fedora Linux
- Proton-GE
- UMU launcher
- Evil West
