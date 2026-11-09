import type { Direction, OpenSide, PeopleInPath, Proximity, VisionAssessment, VisionHazard } from '../../shared/contracts.ts';
import type { DecisionAnswer, DecisionQuestion, DecisionsRequest } from './openai.ts';

/**
 * Obstacle assessment via OpenAI Decisions. The model answers fixed questions
 * with probabilities; we map them to a conservative, speakable result.
 *
 * Priorities (Daniel, 2026-11-09):
 *  1. FIXED obstacles (things that won't move) are what we help route around.
 *  2. People move on their own. A single passer-by is not announced; a GROUP
 *     or crowd in the path is, because it's worth going around.
 *  3. When something is in the path, say which side has more open floor.
 *
 * Safety stance: we only ever claim "no fixed obstacles detected in view",
 * never that a path is safe. Unclear frames return `unknown`.
 */

const CONTEXT =
  'This photo is from a phone camera held at chest height by a blind or low-vision person walking ' +
  'through a conference venue. "The walking path" means the floor area directly ahead, about one ' +
  'body-width wide, up to roughly 4 meters away. "Fixed obstacles" are things that will not move out ' +
  'of the way on their own: furniture, columns, walls, closed doors, steps and stairs, sign stands, ' +
  'stanchions and barriers, booths, carts, and bags or boxes on the floor. People are NOT fixed obstacles.';

const NONE = { value: 'none', description: 'Nothing like this is visible.' };

export const VISION_QUESTIONS: DecisionQuestion[] = [
  {
    type: 'predicate',
    name: 'image_usable',
    instructions:
      'Is the image clear enough to judge the walking path? Answer false if it is very blurry, too dark, ' +
      'covered by a finger, or pointed at the ceiling or at the floor right by the feet.',
  },
  {
    type: 'predicate',
    name: 'fixed_obstacle_in_path',
    instructions:
      'Is there a FIXED obstacle (not a person) in or partly in the walking path within about 4 meters? ' +
      'Ignore people entirely for this question.',
  },
  {
    type: 'choice',
    name: 'fixed_obstacle_kind',
    instructions: 'What is the nearest fixed obstacle (not a person) in or near the walking path?',
    choices: [
      { value: 'furniture', description: 'Chair, table, bench, booth counter, or cart.' },
      { value: 'step_or_stairs', description: 'A step, curb, ramp edge, stairs, or escalator.' },
      { value: 'column_or_wall', description: 'A column, pillar, wall, glass panel, or closed door.' },
      { value: 'sign_or_barrier', description: 'Sign stand, stanchion, rope, or barrier.' },
      { value: 'object_on_floor', description: 'Bag, box, cable, or other object on the floor.' },
      { value: 'other', description: 'Some other fixed obstacle.' },
      NONE,
    ],
  },
  {
    type: 'choice',
    name: 'fixed_obstacle_direction',
    instructions: 'Where is the nearest fixed obstacle relative to the walking path?',
    choices: [
      { value: 'left', description: 'Mostly on the left side of the path.' },
      { value: 'ahead', description: 'In the middle of the path.' },
      { value: 'right', description: 'Mostly on the right side of the path.' },
      NONE,
    ],
  },
  {
    type: 'score',
    name: 'fixed_obstacle_distance',
    instructions: 'How far away is the nearest fixed obstacle in or near the walking path?',
    levels: [
      { label: 'near', description: 'Within about 1 meter, a step or two away.' },
      { label: 'mid', description: 'About 1 to 3 meters away.' },
      { label: 'far', description: 'More than about 3 meters away, or none visible.' },
    ],
  },
  {
    type: 'choice',
    name: 'people_in_path',
    instructions: 'How many people are in or right next to the walking path within about 4 meters?',
    choices: [
      { value: 'none', description: 'No people in or next to the path.' },
      { value: 'single', description: 'One person, for example someone walking past.' },
      { value: 'group', description: 'Two to five people close together, such as a group chatting or a short queue.' },
      { value: 'crowd', description: 'A dense crowd filling the path.' },
    ],
  },
  {
    type: 'predicate',
    name: 'people_stationary',
    instructions:
      'Are the people in the walking path mostly standing still (talking, queuing, gathered) rather than walking through?',
  },
  {
    type: 'choice',
    name: 'people_direction',
    instructions: 'Where are the people in or near the walking path?',
    choices: [
      { value: 'left', description: 'Mostly on the left side of the path.' },
      { value: 'ahead', description: 'In the middle of the path.' },
      { value: 'right', description: 'Mostly on the right side of the path.' },
      NONE,
    ],
  },
  {
    type: 'choice',
    name: 'open_side',
    instructions:
      'To go around whatever is in the walking path, which side has more open floor that looks walkable?',
    choices: [
      { value: 'left', description: 'More open floor on the left.' },
      { value: 'right', description: 'More open floor on the right.' },
      { value: 'either', description: 'Both sides look about equally open, or the path is already open.' },
      { value: 'neither', description: 'Neither side looks open; the way ahead looks blocked.' },
    ],
  },
];

export function buildVisionRequest(imageDataUrl: string): DecisionsRequest {
  return {
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: CONTEXT },
          { type: 'input_image', image_url: imageDataUrl },
        ],
      },
    ],
    questions: VISION_QUESTIONS,
  };
}

/** Thresholds are deliberately conservative: when unsure, say so. */
export const THRESHOLDS = {
  usable: 0.6,
  fixedYes: 0.6,
  fixedNo: 0.2,
  choiceConfidence: 0.4,
  stationary: 0.5,
  /** A spoken detour hint needs more certainty than a displayed one. */
  sideHintConfidence: 0.5,
};

const KIND_PHRASE: Record<string, string> = {
  furniture: 'Furniture',
  step_or_stairs: 'Step or stairs',
  column_or_wall: 'Column or wall',
  sign_or_barrier: 'Sign or barrier',
  object_on_floor: 'Object on the floor',
  other: 'Obstacle',
};

function find<T extends DecisionAnswer['type']>(answers: DecisionAnswer[], name: string, type: T) {
  return answers.find((a): a is Extract<DecisionAnswer, { type: T }> => a.name === name && a.type === type);
}

function confidentChoice(answers: DecisionAnswer[], name: string): string | null {
  const a = find(answers, name, 'choice');
  return a && a.confidence >= THRESHOLDS.choiceConfidence ? a.choice : null;
}

function direction(answers: DecisionAnswer[], name: string): Direction {
  const c = confidentChoice(answers, name);
  return c === 'left' || c === 'ahead' || c === 'right' ? c : 'unclear';
}

function proximity(answers: DecisionAnswer[], name: string): Proximity {
  const a = find(answers, name, 'score');
  if (!a || a.confidence < THRESHOLDS.choiceConfidence) return 'unclear';
  // score is the expected level index (0=near, 1=mid, 2=far).
  return a.score < 0.67 ? 'near' : a.score < 1.5 ? 'mid' : 'far';
}

function where(d: Direction): string {
  return d === 'ahead' ? 'ahead' : d === 'unclear' ? 'nearby' : `on the ${d}`;
}

function howFar(p: Proximity): string {
  return p === 'near' ? ', close' : p === 'mid' ? ', a few steps away' : '';
}

/**
 * Route hint for something in the path. Never says "safe". Suppressed when the
 * model isn't sure, or when it would point toward an obstacle we just named.
 */
function sideHint(openSide: OpenSide, confidence: number, inPath: boolean, mentioned: VisionHazard[]): string {
  if (!inPath || confidence < THRESHOLDS.sideHintConfidence) return '';
  if ((openSide === 'left' || openSide === 'right') && mentioned.some((h) => h.direction === openSide)) return '';
  if (openSide === 'left') return ' More room on the left.';
  if (openSide === 'right') return ' More room on the right.';
  if (openSide === 'neither') return ' The way ahead may be blocked; check with your cane or guide.';
  return '';
}

export function mapVisionAnswers(answers: DecisionAnswer[], frameSeq: number, now = Date.now()): VisionAssessment {
  const usable = find(answers, 'image_usable', 'predicate');
  const fixed = find(answers, 'fixed_obstacle_in_path', 'predicate');
  if (!usable || !fixed) return { state: 'unknown', frameSeq, reason: 'Incomplete answer from the AI service.' };
  if (usable.probability < THRESHOLDS.usable) {
    return { state: 'unknown', frameSeq, reason: 'Camera view unclear. Hold the phone upright, facing ahead.' };
  }

  const peopleChoice = confidentChoice(answers, 'people_in_path');
  const people: PeopleInPath =
    peopleChoice === 'none' || peopleChoice === 'single' || peopleChoice === 'group' || peopleChoice === 'crowd'
      ? peopleChoice
      : 'unclear';
  const sideChoice = confidentChoice(answers, 'open_side');
  const openSide: OpenSide =
    sideChoice === 'left' || sideChoice === 'right' || sideChoice === 'either' || sideChoice === 'neither'
      ? sideChoice
      : 'unclear';

  const hazards: VisionHazard[] = [];

  // 1. Fixed obstacles.
  let fixedHazard: VisionHazard | null = null;
  if (fixed.probability >= THRESHOLDS.fixedYes) {
    const k = confidentChoice(answers, 'fixed_obstacle_kind');
    fixedHazard = {
      kind: 'fixed',
      label: k && k !== 'none' ? k : 'other',
      direction: direction(answers, 'fixed_obstacle_direction'),
      proximity: proximity(answers, 'fixed_obstacle_distance'),
    };
    hazards.push(fixedHazard);
  }

  // 2. Groups of people worth going around (never a single passer-by).
  let peopleHazard: VisionHazard | null = null;
  if (people === 'group' || people === 'crowd') {
    const stationary = find(answers, 'people_stationary', 'predicate');
    // A group walking through clears itself; only flag it if it's standing in the way (or it's a crowd).
    if (people === 'crowd' || !stationary || stationary.probability >= THRESHOLDS.stationary) {
      peopleHazard = { kind: 'people', label: people, direction: direction(answers, 'people_direction'), proximity: 'unclear' };
      hazards.push(peopleHazard);
    }
  }

  // Pick what to say. A fixed obstacle IN the path and not far wins; otherwise a
  // group in the way; otherwise any other fixed obstacle (e.g. off to one side).
  const inPath = (h: VisionHazard) => h.direction === 'ahead' || h.direction === 'unclear';
  const fixedUrgent =
    fixedHazard && inPath(fixedHazard) && (fixedHazard.proximity === 'near' || fixedHazard.proximity === 'mid');
  const lead = fixedUrgent ? fixedHazard : (peopleHazard ?? fixedHazard);

  if (lead) {
    const describeFixed = (h: VisionHazard) =>
      `${KIND_PHRASE[h.label] ?? 'Obstacle'} ${where(h.direction)}${howFar(h.proximity)}.`;
    const what =
      lead.kind === 'fixed'
        ? describeFixed(lead)
        : `${lead.label === 'crowd' ? 'Crowd' : 'Group of people'} ${where(lead.direction)}.`;
    // When people lead, still mention a fixed obstacle so the detour hint makes sense.
    const also = lead.kind === 'people' && fixedHazard ? ` ${describeFixed(fixedHazard)}` : '';
    return {
      state: 'ok',
      frameSeq,
      assessedAt: now,
      spokenSummary: `${what}${also}${sideHint(
        openSide,
        find(answers, 'open_side', 'choice')?.confidence ?? 0,
        inPath(lead),
        also ? [lead, fixedHazard!] : [lead],
      )}`,
      hazards,
      people,
      openSide,
      clearOfVisibleObstacles: false,
      alertKey: `${lead.kind}:${lead.label}:${lead.direction}`,
    };
  }

  if (fixed.probability <= THRESHOLDS.fixedNo) {
    return {
      state: 'ok',
      frameSeq,
      assessedAt: now,
      spokenSummary: 'No fixed obstacles detected in view.',
      hazards,
      people,
      openSide,
      clearOfVisibleObstacles: true,
      alertKey: 'clear',
    };
  }
  return { state: 'unknown', frameSeq, reason: 'Not sure about the path ahead.' };
}
