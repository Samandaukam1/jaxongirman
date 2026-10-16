import auth from "./ns/auth";
import checkout from "./ns/checkout";
import common from "./ns/common";
import create from "./ns/create";
import deck from "./ns/deck";
import editor from "./ns/editor";
import errors from "./ns/errors";
import games from "./ns/games";
import generation from "./ns/generation";
import home from "./ns/home";
import inbox from "./ns/inbox";
import labels from "./ns/labels";
import ledger from "./ns/ledger";
import marathon from "./ns/marathon";
import market from "./ns/market";
import misc from "./ns/misc";
import nav from "./ns/nav";
import play from "./ns/play";
import present from "./ns/present";
import profile from "./ns/profile";
import projects from "./ns/projects";
import support from "./ns/support";
import survey from "./ns/survey";
import time from "./ns/time";
import tools from "./ns/tools";
import wallet from "./ns/wallet";

/**
 * Every table, by namespace. A screen asks for its own namespace
 * (`useTranslation("home")`) and the shared words come from `common`.
 */
const tables = {
  auth,
  checkout,
  common,
  create,
  deck,
  editor,
  errors,
  games,
  generation,
  home,
  inbox,
  labels,
  ledger,
  marathon,
  market,
  misc,
  nav,
  play,
  present,
  profile,
  projects,
  support,
  survey,
  time,
  tools,
  wallet,
};

type Tables = typeof tables;
type For<L extends "uz" | "en" | "ru"> = { [K in keyof Tables]: Tables[K][L] };

function pick<L extends "uz" | "en" | "ru">(language: L): For<L> {
  return Object.fromEntries(Object.entries(tables).map(([name, table]) => [name, table[language]])) as For<L>;
}

export const resources = { uz: pick("uz"), en: pick("en"), ru: pick("ru") };
export const NAMESPACES = Object.keys(tables) as (keyof Tables)[];
