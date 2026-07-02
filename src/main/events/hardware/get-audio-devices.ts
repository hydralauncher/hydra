import { AudioDeviceManager } from "@main/services";
import { registerEvent } from "../register-event";

const getAudioDevices = async () => AudioDeviceManager.getAudioDevices();

registerEvent("getAudioDevices", getAudioDevices);
