import { memo } from "react";
import { Image, type ImageRequireSource } from "react-native";

import createGame from "../../assets/icons/oyingoh/create.png";
import crossword from "../../assets/icons/oyingoh/crossword.png";
import gamepad from "../../assets/icons/oyingoh/gamepad.png";
import gift from "../../assets/icons/oyingoh/gift.png";
import host from "../../assets/icons/oyingoh/host.png";
import join from "../../assets/icons/oyingoh/join.png";
import mafia from "../../assets/icons/oyingoh/mafia.png";
import medal from "../../assets/icons/oyingoh/medal.png";
import play from "../../assets/icons/oyingoh/play.png";
import quiz from "../../assets/icons/oyingoh/quiz.png";
import store from "../../assets/icons/oyingoh/store.png";
import team from "../../assets/icons/oyingoh/team.png";
import tests from "../../assets/icons/oyingoh/tests.png";
import trophy from "../../assets/icons/oyingoh/trophy.png";
import type { Art, ArtProps } from "@/components/toolArt";

/**
 * O‘yingoh's drawings: the same liquid glass as Loyihalar's tools, each in a
 * gradient of its own related colours (violet to pink, turquoise to blue,
 * yellow to orange…), on a transparent ground so they sit on a white card by
 * day and a near-black one by night alike.
 *
 * Kept light: each is drawn at three times the largest size the app shows it
 * (the hero's 74 pt → 222 px, a tile's 54 pt → 162 px, the small ones' 30–38 pt
 * → 120 px) and stored as a palette PNG with alpha, 7–15 KB apiece. Same call
 * shape as `toolArt` (`<Art width height />`), so a ToolCard does not know
 * which it was handed.
 */
function drawing(source: ImageRequireSource, name: string): Art {
  const Drawing = memo(function Drawing({ width, height }: ArtProps) {
    return <Image source={source} style={{ width, height }} resizeMode="contain" accessible={false} />;
  });
  Drawing.displayName = name;
  return Drawing;
}

export const CreateGameArt = drawing(createGame, "CreateGameArt");
export const JoinArt = drawing(join, "JoinArt");
export const HostArt = drawing(host, "HostArt");
export const CrosswordArt = drawing(crossword, "CrosswordArt");
export const TestsArt = drawing(tests, "TestsArt");
export const MafiaArt = drawing(mafia, "MafiaArt");
export const TeamArt = drawing(team, "TeamArt");
export const GamepadArt = drawing(gamepad, "GamepadArt");
export const TrophyArt = drawing(trophy, "TrophyArt");
export const MedalArt = drawing(medal, "MedalArt");
export const GiftArt = drawing(gift, "GiftArt");
export const StoreArt = drawing(store, "StoreArt");
export const PlayArt = drawing(play, "PlayArt");
export const QuizArt = drawing(quiz, "QuizArt");
