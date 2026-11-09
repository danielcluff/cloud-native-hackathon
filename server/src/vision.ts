import type { Direction, OpenSide, PeopleInPath, Proximity, VisionAssessment, VisionHazard } from '../../shared/contracts.ts';
import type { DecisionAnswer, DecisionQuestion, DecisionsRequest } from './openai.ts';

/**
 * Obstacle assessment via OpenAI Decisions. The model answers fixed questions
 * with probabilities; we map them to a conservative, speakable result.
 *
 * Priorities (Daniel, 2026-11-09):
 *  1. FIXED obstacles (things that won't move) are what we help route around.
 *  2. Groups and crowds can obstruct the path. The phone confirms a lone
 *     standing person over multiple frames before announcing them.
 *  3. When something is in the path, look for the nearest visible opening.
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
const DIRECTION_CHOICES = [
  { value: 'left', description: 'Clearly to the walker’s left, alongside the path.' },
  { value: 'slight_left', description: 'Ahead and just left of center, at the left edge of the walking path.' },
  { value: 'ahead', description: 'Directly ahead, in the center of the walking path.' },
  { value: 'slight_right', description: 'Ahead and just right of center, at the right edge of the walking path.' },
  { value: 'right', description: 'Clearly to the walker’s right, alongside the path.' },
  NONE,
];
const FIXED_TARGET =
  'Use the same obstacle for kind, direction and distance: the nearest fixed obstacle in the path, ' +
  'or, if none is in the path, the nearest fixed obstacle within about one meter alongside it.';

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
    instructions: `What kind of obstacle is it? ${FIXED_TARGET} An occupied chair still counts as a chair.`,
    choices: [
      { value: 'table', description: 'A table or desk, including its legs and projecting edge.' },
      { value: 'chair', description: 'A chair or stool, occupied or empty.' },
      { value: 'furniture', description: 'Other furniture, such as a bench, booth counter, or cart.' },
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
    instructions: `Where is the obstacle from the walker’s point of view? ${FIXED_TARGET} Use the nearest part that could obstruct the walker.`,
    choices: DIRECTION_CHOICES,
  },
  {
    type: 'score',
    name: 'fixed_obstacle_distance',
    instructions: `How far away is the nearest edge of the obstacle? ${FIXED_TARGET}`,
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
      'Do the people in or near the walking path appear to be standing in place (talking, queuing, gathered)? ' +
      'For one person, look for a standing posture with planted feet. If they appear to be walking or their posture is unclear, answer false.',
  },
  {
    type: 'choice',
    name: 'people_direction',
    instructions: 'Where are the people in or near the walking path?',
    choices: DIRECTION_CHOICES,
  },
  {
    type: 'predicate',
    name: 'single_person_close',
    instructions:
      'If exactly one person is in or beside the walking path, are they within roughly one meter of the walker? ' +
      'Judge distance to the person, using their position on the floor. Answer false if unsure.',
  },
  {
    type: 'choice',
    name: 'open_side',
    instructions:
      'When an obstacle blocks the path ahead, look for the nearest visible opening around its left or right edge. ' +
      'Look for a continuous strip of visible floor, roughly body-width, from the foreground past the obstacle. ' +
      'Account for chair legs, table edges, bags, partitions, and people in the approach. ' +
      'Prefer the opening that needs less sideways movement. Ignore open floor that cannot be reached from here in view. ' +
      'Choose unclear when the floor or route around the obstacle is obscured.',
    choices: [
      { value: 'left', description: 'The closest visible opening around the obstacle is on the walker’s left.' },
      { value: 'right', description: 'The closest visible opening around the obstacle is on the walker’s right.' },
      { value: 'either', description: 'The openings look about equally close, or there is no obstacle to go around.' },
      { value: 'neither', description: 'The approach and both sides are visible and both sides appear blocked.' },
      { value: 'unclear', description: 'There is not enough visible floor to judge an opening.' },
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
  singlePersonConfidence: 0.65,
  /** A spoken detour hint needs more certainty than a displayed one. */
  sideHintConfidence: 0.6,
};

const KIND_PHRASE: Record<string, string> = {
  table: 'Table',
  chair: 'Chair',
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
  return c === 'left' || c === 'slight_left' || c === 'ahead' || c === 'slight_right' || c === 'right'
    ? c
    : 'unclear';
}

function proximity(answers: DecisionAnswer[], name: string): Proximity {
  const a = find(answers, name, 'score');
  if (!a || a.confidence < THRESHOLDS.choiceConfidence) return 'unclear';
  // score is the expected level index (0=near, 1=mid, 2=far).
  return a.score < 0.67 ? 'near' : a.score < 1.5 ? 'mid' : 'far';
}

function where(d: Direction): string {
  if (d === 'slight_left') return 'slightly left';
  if (d === 'slight_right') return 'slightly right';
  return d === 'ahead' ? 'ahead' : d === 'unclear' ? 'nearby' : `on the ${d}`;
}

function howFar(p: Proximity): string {
  return p === 'near' ? ', close' : '';
}

/**
 * Route hint for something in the path. Never says "safe". Suppressed when the
 * model isn't sure, or when it would point toward another detected obstacle.
 */
function sideHint(openSide: OpenSide, confidence: number, inPath: boolean, hazards: VisionHazard[]): string {
  if (!inPath || confidence < THRESHOLDS.sideHintConfidence) return '';
  if (hazards.some((h) => h.direction === openSide || h.direction === `slight_${openSide}`)) return '';
  if (openSide === 'left' || openSide === 'right') return ` Opening on the ${openSide}.`;
  if (openSide === 'neither') return ' Ahead may be blocked.';
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
  const stationary = find(answers, 'people_stationary', 'predicate');
  const peopleDirection = direction(answers, 'people_direction');
  let standingPerson: 'in_front' | 'close_ahead' | undefined;
  if (people === 'single' && (stationary?.probability ?? 0) >= THRESHOLDS.singlePersonConfidence) {
    const close = find(answers, 'single_person_close', 'predicate');
    if (peopleDirection === 'ahead' || peopleDirection === 'slight_left' || peopleDirection === 'slight_right') {
      standingPerson = peopleDirection === 'ahead' && (close?.probability ?? 0) >= THRESHOLDS.singlePersonConfidence
        ? 'close_ahead'
        : 'in_front';
    }
  }

  const hazards: VisionHazard[] = [];

  // 1. Fixed obstacles.
  const fixedKind = confidentChoice(answers, 'fixed_obstacle_kind');
  const fixedDirection = direction(answers, 'fixed_obstacle_direction');
  const fixedProximity = proximity(answers, 'fixed_obstacle_distance');
  const nearAlongside = fixedKind && fixedKind !== 'none' && fixedProximity === 'near' &&
    (fixedDirection === 'left' || fixedDirection === 'right');
  let fixedHazard: VisionHazard | null = null;
  if (fixed.probability >= THRESHOLDS.fixedYes || nearAlongside) {
    fixedHazard = {
      kind: 'fixed',
      label: fixedKind && fixedKind !== 'none' ? fixedKind : 'other',
      direction: fixedDirection,
      proximity: fixedProximity,
    };
    hazards.push(fixedHazard);
  }

  // 2. Groups of people worth going around (never a single passer-by).
  let peopleHazard: VisionHazard | null = null;
  if (people === 'group' || people === 'crowd') {
    // A group walking through clears itself; only flag it if it's standing in the way (or it's a crowd).
    if (people === 'crowd' || !stationary || stationary.probability >= THRESHOLDS.stationary) {
      peopleHazard = { kind: 'people', label: people, direction: peopleDirection, proximity: 'unclear' };
      hazards.push(peopleHazard);
    }
  }

  // Pick what to say. A fixed obstacle IN the path and not far wins; otherwise a
  // group in the way; otherwise any other fixed obstacle (e.g. off to one side).
  const inPath = (h: VisionHazard) => h.direction !== 'left' && h.direction !== 'right';
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
    const hint = sideHint(openSide, find(answers, 'open_side', 'choice')?.confidence ?? 0, inPath(lead), hazards);
    return {
      state: 'ok',
      frameSeq,
      assessedAt: now,
      spokenSummary: `${what}${also}${hint}`,
      hazards,
      people,
      standingPerson,
      openSide,
      clearOfVisibleObstacles: false,
      alertKey: `${lead.kind}:${lead.label}:${lead.direction}${hint ? `:opening:${openSide}` : ''}`,
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
      standingPerson,
      openSide,
      clearOfVisibleObstacles: true,
      alertKey: 'clear',
    };
  }
  return { state: 'unknown', frameSeq, reason: 'Not sure about the path ahead.' };
}
