import assert from "node:assert/strict";
import test from "node:test";

import { buildEdgeModules } from "../scripts/build-edge.mjs";

const edge = buildEdgeModules();
const { bestWikimedia, fileTitle, plainText, rankWikimedia } = await import(`${edge}/wikimedia-results.js`);

/**
 * Reading Commons, which is messier than a stock library on purpose.
 *
 * A search for "Amir Temur" comes back with a mausoleum, a banknote, a street
 * sign and a portrait, in whatever order the index likes. Taking the first is
 * not good enough often enough, and picking at random is worse than either — so
 * these are the rules that decide.
 */

const page = (over = {}) => ({
  title: over.title ?? "File:Amir Temur portrait.jpg",
  imageinfo: [{
    url: "https://upload.wikimedia.org/original.jpg",
    thumburl: "https://upload.wikimedia.org/thumb/1600px.jpg",
    thumbwidth: 1600, thumbheight: 1067,
    width: 4000, height: 2667,
    mime: "image/jpeg",
    descriptionurl: "https://commons.wikimedia.org/wiki/File:Amir_Temur_portrait.jpg",
    extmetadata: {
      Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Someone">Someone</a>' },
      LicenseShortName: { value: "CC BY-SA 4.0" },
      LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0" },
      ObjectName: { value: "Amir Temur portrait" },
      ...over.extmetadata,
    },
    ...over.info,
  }],
});

/* ------------------------------------------------------------------- text */

test("metadata arrives as HTML and leaves as text", () => {
  // A credits slide shows text. The artist comes back as a link, the credit as
  // a span, and both go straight onto a slide somebody presents.
  assert.equal(plainText('<a href="//x">Marat Nadjibaev</a>'), "Marat Nadjibaev");
  assert.equal(plainText('<span class="int-own-work" lang="en">Own work</span>'), "Own work");
  assert.equal(plainText("Bir&nbsp;ikki &amp; uch"), "Bir ikki & uch");
  assert.equal(plainText(undefined), "");
});

test("a file name becomes a title", () => {
  assert.equal(fileTitle("File:Amir_Temur_yer_osti_dahmasi_2.jpg"), "Amir Temur yer osti dahmasi 2");
});

/* ------------------------------------------------------------- what is kept */

test("a picture nobody can be credited for is refused", () => {
  // The same rule the other two providers apply: no photographer or no file
  // page means it cannot be published, whatever it shows.
  const noArtist = page({ extmetadata: { Artist: { value: "" } } });
  const noSource = page({ info: { descriptionurl: undefined } });
  assert.equal(rankWikimedia([noArtist], "Amir Temur").length, 0);
  assert.equal(rankWikimedia([noSource], "Amir Temur").length, 0);
});

test("a format no renderer draws is refused", () => {
  // A slide is drawn by React Native, by the DOM and by PowerPoint. Raster is
  // the only thing all three agree on.
  for (const mime of ["video/webm", "audio/ogg", "application/pdf", "image/tiff"]) {
    assert.equal(rankWikimedia([page({ info: { mime } })], "Amir Temur").length, 0, `${mime} was accepted`);
  }
});

test("a vector file is taken through its rendered thumbnail, never as itself", () => {
  /**
   * MediaWiki renders an SVG thumbnail as a PNG — its own rasterisation, not a
   * conversion invented here. Taking the `.svg` would ship a file the phone
   * cannot draw and PowerPoint draws only in recent versions.
   */
  const [best] = rankWikimedia([page({
    title: "File:Flag of Uzbekistan.svg",
    info: { mime: "image/svg+xml", url: "https://upload.wikimedia.org/Flag.svg" },
  })], "Flag of Uzbekistan");

  assert.ok(best, "a vector file should still be usable");
  assert.equal(best.hit.url, "https://upload.wikimedia.org/thumb/1600px.jpg", "the rendered variant is the picture");
  assert.equal(best.hit.mimeType, "image/png");
  assert.equal(best.hit.originalUrl, "https://upload.wikimedia.org/Flag.svg", "the original stays addressable");
});

test("a picture too small to put on a slide is refused", () => {
  assert.equal(rankWikimedia([page({ info: { width: 320, height: 240 } })], "Amir Temur").length, 0);
});

/* ------------------------------------------------------------------ ranking */

test("what the picture is of beats how big it is", () => {
  // A big photograph of the wrong thing is still the wrong thing.
  const wrong = page({ title: "File:Tashkent metro station.jpg", extmetadata: { ObjectName: { value: "Tashkent metro" } }, info: { thumbwidth: 1600, width: 9000 } });
  const right = page({ title: "File:Amir Temur monument.jpg", extmetadata: { ObjectName: { value: "Amir Temur monument" } }, info: { thumbwidth: 1200, width: 1600 } });

  const [best] = rankWikimedia([wrong, right], "Amir Temur");
  assert.match(best.hit.attribution.title, /Amir Temur/);
});

test("the orientation the design asked for is preferred, not required", () => {
  const wide = page({ title: "File:Amir Temur wide.jpg", extmetadata: { ObjectName: { value: "Amir Temur wide" } }, info: { thumbwidth: 1600, thumbheight: 900 } });
  const tall = page({ title: "File:Amir Temur tall.jpg", extmetadata: { ObjectName: { value: "Amir Temur tall" } }, info: { thumbwidth: 900, thumbheight: 1600 } });

  assert.match(rankWikimedia([tall, wide], "Amir Temur", "landscape")[0].hit.attribution.title, /wide/);
  assert.match(rankWikimedia([wide, tall], "Amir Temur", "portrait")[0].hit.attribution.title, /tall/);
  // A search that finds only the wrong shape still answers: an unusual crop
  // beats no picture at all.
  assert.ok(rankWikimedia([tall], "Amir Temur", "landscape").length > 0);
});

test("the same results always produce the same choice", () => {
  // A deck has to be reproducible. Nothing here may depend on the order the
  // index happened to answer in.
  const pages = [
    page({ title: "File:B.jpg", extmetadata: { ObjectName: { value: "Amir Temur B" } } }),
    page({ title: "File:A.jpg", extmetadata: { ObjectName: { value: "Amir Temur A" } } }),
  ];
  const first = rankWikimedia(pages, "Amir Temur")[0].hit.attribution.title;
  const again = rankWikimedia([...pages].reverse(), "Amir Temur")[0].hit.attribution.title;
  assert.equal(first, again);
});

test("the credit survives the trip", () => {
  const hit = bestWikimedia([page()], "Amir Temur");
  assert.equal(hit.attribution.provider, "wikimedia");
  assert.equal(hit.attribution.creator, "Someone");
  assert.equal(hit.attribution.license, "CC BY-SA 4.0");
  assert.match(hit.attribution.licenseUrl, /^https:\/\//);
  assert.match(hit.attribution.sourceUrl, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
  assert.ok(hit.width > 0 && hit.height > 0);
});

test("stepping past a choice gives the next best, not the same one", () => {
  const pages = [
    page({ title: "File:One.jpg", extmetadata: { ObjectName: { value: "Amir Temur one" } } }),
    page({ title: "File:Two.jpg", extmetadata: { ObjectName: { value: "Amir Temur two" } } }),
  ];
  const first = bestWikimedia(pages, "Amir Temur", "any", 0);
  const second = bestWikimedia(pages, "Amir Temur", "any", 1);
  assert.notEqual(first.attribution.title, second.attribution.title);
  assert.equal(bestWikimedia(pages, "Amir Temur", "any", 9), null, "past the end is nothing, not a wrap-around");
});
