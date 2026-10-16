import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";

import {
  shouldPauseOnToggle,
  shouldSpaceTogglePlayback,
} from "./gallery-playback.js";

describe("shouldPauseOnToggle", () => {
  it("pauses a trailer that is playing", () => {
    assert.equal(
      shouldPauseOnToggle({ paused: false, ended: false, pendingPlay: false }),
      true
    );
  });

  it("plays a trailer that is paused or ended", () => {
    assert.equal(
      shouldPauseOnToggle({ paused: true, ended: false, pendingPlay: false }),
      false
    );
    assert.equal(
      shouldPauseOnToggle({ paused: false, ended: true, pendingPlay: false }),
      false
    );
  });

  it("pauses a trailer whose autoplay is still waiting for metadata", () => {
    assert.equal(
      shouldPauseOnToggle({ paused: true, ended: false, pendingPlay: true }),
      true
    );
  });
});

describe("shouldSpaceTogglePlayback", () => {
  const { document } = new JSDOM(`
    <button id="outside">Outside</button>
    <div id="gallery">
      <button id="thumbnail">Thumbnail</button>
      <div class="gallery-video">
        <div id="surface"></div>
        <button id="mute">Mute</button>
        <div class="gallery-video__quality">
          <button id="quality"><span id="quality-icon"></span></button>
        </div>
      </div>
    </div>
  `).window;
  const gallery = document.getElementById("gallery");
  const byId = (id: string) => document.getElementById(id);

  it("toggles playback when nothing activatable has focus", () => {
    assert.equal(shouldSpaceTogglePlayback(document.body, gallery), true);
    assert.equal(shouldSpaceTogglePlayback(byId("surface"), gallery), true);
    assert.equal(shouldSpaceTogglePlayback(null, gallery), true);
  });

  it("toggles playback from gallery controls outside the player", () => {
    assert.equal(shouldSpaceTogglePlayback(byId("thumbnail"), gallery), true);
  });

  it("lets focused player buttons handle Space", () => {
    assert.equal(shouldSpaceTogglePlayback(byId("mute"), gallery), false);
    assert.equal(
      shouldSpaceTogglePlayback(byId("quality-icon"), gallery),
      false
    );
  });

  it("leaves Space alone for controls outside the gallery", () => {
    assert.equal(shouldSpaceTogglePlayback(byId("outside"), gallery), false);
  });
});
