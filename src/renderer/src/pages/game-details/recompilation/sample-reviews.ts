import type { GameReview, RecompilationPortId } from "@types";

/*
 * SAMPLE DATA. No source for port reviews exists yet: every reviewer, score,
 * text, playtime, date and vote below is made up for the prototype (copied
 * from the approved design). Nothing here is read from or sent to the API.
 */

interface SampleReview {
  id: string;
  name: string;
  score: number;
  hours: number;
  createdAt: string;
  upvotes: number;
  downvotes: number;
  text: string;
}

const toGameReview = (sample: SampleReview): GameReview => ({
  id: sample.id,
  reviewHtml: `<p>${sample.text}</p>`,
  score: sample.score,
  createdAt: sample.createdAt,
  updatedAt: sample.createdAt,
  upvotes: sample.upvotes,
  downvotes: sample.downvotes,
  answerCount: 0,
  answers: [],
  isBlocked: false,
  hasUpvoted: false,
  hasDownvoted: false,
  playTimeInSeconds: sample.hours * 60 * 60,
  user: {
    id: "",
    displayName: sample.name,
    profileImageUrl: null,
    backgroundImageUrl: null,
  },
  translations: {},
  detectedLanguage: null,
});

export const SAMPLE_PORT_REVIEWS: Record<RecompilationPortId, GameReview[]> = {
  "2ship2harkinian": [
    {
      id: "sample-2ship2harkinian-1",
      name: "clocktown.tom",
      score: 5,
      hours: 26,
      createdAt: "2026-10-28T18:20:00Z",
      upvotes: 12,
      downvotes: 0,
      text: "Runs smoothly at high resolution, and the menu bar on F1 makes tweaking settings easy. A great way to replay Majora's Mask.",
    },
    {
      id: "sample-2ship2harkinian-2",
      name: "skullkid",
      score: 4,
      hours: 9,
      createdAt: "2026-10-18T09:05:00Z",
      upvotes: 6,
      downvotes: 1,
      text: "On Linux the ROM has to sit next to the AppImage, which took me a minute to figure out. After that, flawless.",
    },
  ].map(toGameReview),
  zelda64recomp: [
    {
      id: "sample-zelda64recomp-1",
      name: "fierce.deity",
      score: 5,
      hours: 33,
      createdAt: "2026-10-27T21:40:00Z",
      upvotes: 21,
      downvotes: 1,
      text: "Gyro aiming with the bow on my Switch Pro controller is a game changer, and high frame rates with the original N64 effects intact look fantastic.",
    },
    {
      id: "sample-zelda64recomp-2",
      name: "tatl.and.tael",
      score: 5,
      hours: 12,
      createdAt: "2026-10-11T14:15:00Z",
      upvotes: 8,
      downvotes: 0,
      text: "Dropped a couple of Thunderstore mods onto the window and they just worked. Autosave saved me more than once.",
    },
  ].map(toGameReview),
};
