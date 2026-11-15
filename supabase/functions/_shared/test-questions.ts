/**
 * Turning what the model wrote into questions a printed test can hold.
 *
 * Dependency-free, so the tests can hold it to its rules: exactly the test's
 * number of options, all different, one of them right — and the right one
 * moved to a place of its own, because a model puts it first far more often
 * than a quarter of the time, and a class learns that within one test.
 */

export type RawTestQuestion = { prompt: string; options: string[]; correct_index: number; explanation: string };
export type TestQuestionRow = { prompt: string; options: string[]; correct: number; explanation: string };

const clean = (value: unknown, max: number) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** One question as the database takes it, or null when it cannot be a fair question. */
export function mapTestQuestion(raw: RawTestQuestion, optionCount: number, spell: (text: string) => string): TestQuestionRow | null {
  const prompt = clean(spell(raw.prompt ?? ""), 1000);
  if (prompt.length < 3) return null;
  const options = (Array.isArray(raw.options) ? raw.options : []).map((option) => clean(spell(String(option ?? "")), 300));
  const correct = Number(raw.correct_index);
  if (!Number.isInteger(correct) || correct < 0 || correct >= options.length) return null;
  const right = options[correct]!;
  // Keep the right one and the first wrong ones, as many as the sheet has bubbles.
  const wrong = options.filter((option, at) => at !== correct && option && option.toLowerCase() !== right.toLowerCase());
  const distinct = [...new Map(wrong.map((option) => [option.toLowerCase(), option])).values()];
  if (!right || distinct.length < optionCount - 1) return null;
  return { prompt, options: [right, ...distinct.slice(0, optionCount - 1)], correct: 0, explanation: clean(spell(raw.explanation ?? ""), 1000) };
}

/**
 * Where each question's right answer goes: every place used about equally
 * often, in an order that does not repeat a pattern — and the same for the
 * same test, so printing it again prints the same sheet.
 */
export function spreadAnswers<T extends { options: string[]; correct: number }>(questions: T[], seed: string): T[] {
  let state = 0x811c9dc5;
  for (const char of seed) state = Math.imul(state ^ char.codePointAt(0)!, 0x01000193) >>> 0;
  const next = () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  const k = questions[0]?.options.length ?? 4;
  const places: number[] = [];
  while (places.length < questions.length) {
    const round = Array.from({ length: k }, (_, at) => at);
    for (let at = round.length - 1; at > 0; at -= 1) {
      const swap = Math.floor(next() * (at + 1));
      [round[at], round[swap]] = [round[swap]!, round[at]!];
    }
    places.push(...round);
  }
  return questions.map((question, index) => {
    const right = question.options[question.correct]!;
    const others = question.options.filter((_, at) => at !== question.correct);
    for (let at = others.length - 1; at > 0; at -= 1) {
      const swap = Math.floor(next() * (at + 1));
      [others[at], others[swap]] = [others[swap]!, others[at]!];
    }
    const place = places[index]! % question.options.length;
    const options = [...others.slice(0, place), right, ...others.slice(place)];
    return { ...question, options, correct: place };
  });
}
