import type {
  OpenSide,
  PathPosition,
  PeopleInPath,
  Proximity,
  Steer,
  VisionAssessment,
  VisionHazard,
} from '../../shared/contracts.ts';
import type { DecisionAnswer, DecisionQuestion, DecisionsRequest } from './openai.ts';

/**
 * Walking-path assessment via OpenAI Decisions.
 *
 * Model of the world (Daniel, 2026-11-09, after a walk-through recording):
 *  - The WALKING PATH is the center band of the camera view. Only things in
 *    that band matter; walls and furniture beside it are not announced.
 *  - Every frame answers: is the path ahead clear? If not, which way to go:
 *    a small "veer" around something, or "turn" to look for a new path
 *    (blocked, or facing a wall).
 *  - Fixed obstacles matter most. People walking through are ignored; a single
 *    person standing in the path is confirmed on the phone over two frames; a
 *    group or crowd in the path is something to go around.
 *  - Never claim a path is safe. "Path ahead looks clear" describes the view.
 */

const CONTEXT =
  'This photo is from a phone held at chest height, pointing forward, by a blind or low-vision person walking ' +
  'through a conference venue. THE WALKING PATH is the vertical band in the middle third of the image, from the ' +
  'bottom edge up to the floor about 3 meters ahead. Only things inside or crossing that band are "in the path". ' +
  'Walls, furniture or people beside the band are NOT in the path. Ignore people who are walking through; count ' +
  'people who are standing still.';

const NONE = { value: 'none', description: 'Nothing in the walking path.' };

export const BLOCKER_KINDS = [
  { value: 'table_or_counter', description: 'A table, counter, desk, bar or booth.' },
  { value: 'chair_or_bench', description: 'A chair, stool, sofa or bench.' },
  { value: 'backpack_or_bag', description: 'A backpack, bag, suitcase or box on the floor.' },
  { value: 'trash_can', description: 'A trash or recycling bin.' },
  { value: 'column_or_pillar', description: 'A column, pillar or post.' },
  { value: 'wall_or_door', description: 'A wall, closed door, glass wall or window.' },
  { value: 'step_or_stairs', description: 'A step, curb, ramp edge, stairs or escalator.' },
  { value: 'sign_or_barrier', description: 'A sign stand, easel, stanchion, rope or barrier.' },
  { value: 'plant_or_decor', description: 'A planter, plant, display or decoration.' },
  { value: 'cable_or_small_object', description: 'A cable, mat edge or small object on the floor.' },
  { value: 'person_standing', description: 'One person standing still.' },
  { value: 'group_of_people', description: 'Two or more people standing together.' },
  { value: 'other', description: 'Something else.' },
  NONE,
];

export const VISION_QUESTIONS: DecisionQuestion[] = [
  {
    type: 'predicate',
    name: 'image_usable',
    instructions:
      'Can you see the scene well enough to judge it? Answer false ONLY if the image is very blurry, too dark, ' +
      'covered by a finger, or pointed at the ceiling or the floor right by the feet. A wall, door or object filling ' +
      'the view IS usable: answer true.',
  },
  {
    type: 'predicate',
    name: 'facing_wall',
    instructions:
      'Is the camera facing a wall, closed door, window or other large surface that fills most of the view within ' +
      'about 1.5 meters, so there is no way forward straight ahead?',
  },
  {
    type: 'predicate',
    name: 'path_clear',
    instructions:
      'Is THE WALKING PATH (center band) clear of anything a person could bump into or trip over for about the next ' +
      '3 meters? Ignore people walking through and anything beside the band.',
  },
  {
    type: 'choice',
    name: 'blocker_kind',
    instructions: 'What is the nearest thing inside THE WALKING PATH?',
    choices: BLOCKER_KINDS,
  },
  {
    type: 'choice',
    name: 'blocker_position',
    instructions: 'Where inside THE WALKING PATH is that nearest thing?',
    choices: [
      { value: 'left_part', description: 'In the left part of the path.' },
      { value: 'center', description: 'In the middle of the path.' },
      { value: 'right_part', description: 'In the right part of the path.' },
      NONE,
    ],
  },
  {
    type: 'score',
    name: 'blocker_distance',
    instructions: 'How far away is the nearest thing inside THE WALKING PATH?',
    levels: [
      { label: 'near', description: 'Within about 1 meter, a step or two away.' },
      { label: 'mid', description: 'About 1 to 3 meters away.' },
      { label: 'far', description: 'More than about 3 meters away, or nothing in the path.' },
    ],
  },
  {
    type: 'predicate',
    name: 'left_open',
    instructions: 'Is there open, walkable floor just to the LEFT of the walking path that a person could step into?',
  },
  {
    type: 'predicate',
    name: 'right_open',
    instructions: 'Is there open, walkable floor just to the RIGHT of the walking path that a person could step into?',
  },
  {
    type: 'choice',
    name: 'steer',
    instructions: 'Which way should the person go to keep walking forward without bumping into anything?',
    choices: [
      { value: 'straight', description: 'Keep going straight; the path ahead is clear.' },
      { value: 'veer_left', description: 'Step slightly left to get around something in the path.' },
      { value: 'veer_right', description: 'Step slightly right to get around something in the path.' },
      { value: 'turn_left', description: 'The way ahead is blocked; turn left to look for another path.' },
      { value: 'turn_right', description: 'The way ahead is blocked; turn right to look for another path.' },
    ],
  },
  {
    type: 'choice',
    name: 'people_in_path',
    instructions: 'How many people are standing still inside THE WALKING PATH? Ignore people walking through.',
    choices: [
      { value: 'none', description: 'Nobody standing in the path.' },
      { value: 'single', description: 'One person standing in the path.' },
      { value: 'group', description: 'Two to five people standing together in the path.' },
      { value: 'crowd', description: 'A dense crowd filling the path.' },
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

/** Conservative thresholds: when unsure, say so rather than guess. */
export const THRESHOLDS = {
  usable: 0.5,
  facingWall: 0.6,
  // Tuned on frames from Daniel's walk-through: a trash can mid-path scored 0.38.
  pathClear: 0.6,
  pathBlocked: 0.45,
  choiceConfidence: 0.4,
  /** Naming only (never decides blocked/steer): a trash can mid-path was named at 0.38. */
  nameConfidence: 0.3,
  sideOpen: 0.5,
};

export const LABEL_PHRASE: Record<string, string> = {
  table_or_counter: 'Table or counter',
  chair_or_bench: 'Chair',
  backpack_or_bag: 'Bag on the floor',
  trash_can: 'Trash can',
  column_or_pillar: 'Column',
  wall_or_door: 'Wall or door',
  step_or_stairs: 'Step or stairs',
  sign_or_barrier: 'Sign or barrier',
  plant_or_decor: 'Planter or display',
  cable_or_small_object: 'Object on the floor',
  person_standing: 'Person standing',
  group_of_people: 'Group of people',
  other: 'Obstacle',
};

const STEER_PHRASE: Record<Steer, string> = {
  straight: 'Path ahead looks clear.',
  veer_left: 'Veer left.',
  veer_right: 'Veer right.',
  turn_left: 'Turn left to find a path.',
  turn_right: 'Turn right to find a path.',
  turn_either: 'Turn left or right to find a path.',
  unclear: '',
};

const POSITION_PHRASE: Record<PathPosition, string> = {
  left_part: 'on the left of your path',
  center: 'ahead',
  right_part: 'on the right of your path',
  unclear: 'in your path',
};

function find<T extends DecisionAnswer['type']>(answers: DecisionAnswer[], name: string, type: T) {
  return answers.find((a): a is Extract<DecisionAnswer, { type: T }> => a.name === name && a.type === type);
}

function confidentChoice(answers: DecisionAnswer[], name: string): string | null {
  const a = find(answers, name, 'choice');
  return a && a.confidence >= THRESHOLDS.choiceConfidence ? a.choice : null;
}

function prob(answers: DecisionAnswer[], name: string): number | null {
  return find(answers, name, 'predicate')?.probability ?? null;
}

function proximity(answers: DecisionAnswer[]): Proximity {
  const a = find(answers, 'blocker_distance', 'score');
  if (!a || a.confidence < THRESHOLDS.choiceConfidence) return 'unclear';
  // score is the expected level index (0=near, 1=mid, 2=far).
  return a.score < 0.67 ? 'near' : a.score < 1.5 ? 'mid' : 'far';
}

function howFar(p: Proximity): string {
  return p === 'near' ? ', close' : p === 'mid' ? ', a few steps away' : '';
}

/**
 * Decide which way to go. The model's own `steer` answer is used when it's
 * confident and consistent with the open-floor answers; otherwise we derive it
 * from where the obstacle sits and which side is open.
 */
export function resolveSteer(opts: {
  modelSteer: string | null;
  blocked: boolean;
  facingWall: boolean;
  position: PathPosition;
  leftOpen: number | null;
  rightOpen: number | null;
}): Steer {
  const left = (opts.leftOpen ?? 0) >= THRESHOLDS.sideOpen;
  const right = (opts.rightOpen ?? 0) >= THRESHOLDS.sideOpen;
  const better = (): 'left' | 'right' | null =>
    left && !right
      ? 'left'
      : right && !left
        ? 'right'
        : left && right
          ? (opts.leftOpen ?? 0) >= (opts.rightOpen ?? 0)
            ? 'left'
            : 'right'
          : null;
  const modelSide = (): 'left' | 'right' | null =>
    opts.modelSteer === 'turn_left' || opts.modelSteer === 'veer_left'
      ? 'left'
      : opts.modelSteer === 'turn_right' || opts.modelSteer === 'veer_right'
        ? 'right'
        : null;

  if (opts.facingWall) {
    const side = better() ?? modelSide();
    return side ? `turn_${side}` : 'turn_either';
  }
  if (!opts.blocked) return 'straight';

  const m = opts.modelSteer;
  if (m === 'veer_left' && (left || opts.leftOpen === null)) return 'veer_left';
  if (m === 'veer_right' && (right || opts.rightOpen === null)) return 'veer_right';
  if (m === 'turn_left' || m === 'turn_right') return m;

  // Derive: go around on the side away from the obstacle, if that side is open.
  if (opts.position === 'left_part' && right) return 'veer_right';
  if (opts.position === 'right_part' && left) return 'veer_left';
  const side = better();
  if (side) return `veer_${side}`;
  return 'turn_either';
}

export function mapVisionAnswers(answers: DecisionAnswer[], frameSeq: number, now = Date.now()): VisionAssessment {
  const usable = prob(answers, 'image_usable');
  const clear = prob(answers, 'path_clear');
  if (usable === null || clear === null) {
    return { state: 'unknown', frameSeq, reason: 'Incomplete answer from the AI service.' };
  }
  const facingWall = (prob(answers, 'facing_wall') ?? 0) >= THRESHOLDS.facingWall;
  // A wall filling the view is a real answer, not an unusable frame.
  if (usable < THRESHOLDS.usable && !facingWall) {
    return { state: 'unknown', frameSeq, reason: 'Camera view unclear. Point the phone forward at chest height.' };
  }

  const leftOpen = prob(answers, 'left_open');
  const rightOpen = prob(answers, 'right_open');
  const openSide: OpenSide =
    leftOpen === null || rightOpen === null
      ? 'unclear'
      : leftOpen >= THRESHOLDS.sideOpen && rightOpen >= THRESHOLDS.sideOpen
        ? 'either'
        : leftOpen >= THRESHOLDS.sideOpen
          ? 'left'
          : rightOpen >= THRESHOLDS.sideOpen
            ? 'right'
            : 'neither';

  const peopleChoice = confidentChoice(answers, 'people_in_path');
  const people: PeopleInPath =
    peopleChoice === 'none' || peopleChoice === 'single' || peopleChoice === 'group' || peopleChoice === 'crowd'
      ? peopleChoice
      : 'unclear';

  const kindAnswer = find(answers, 'blocker_kind', 'choice');
  const kindChoice = kindAnswer && kindAnswer.confidence >= THRESHOLDS.nameConfidence ? kindAnswer.choice : null;
  const posChoice = confidentChoice(answers, 'blocker_position');
  const position: PathPosition =
    posChoice === 'left_part' || posChoice === 'center' || posChoice === 'right_part' ? posChoice : 'unclear';

  const blocked = facingWall || clear <= THRESHOLDS.pathBlocked;
  if (!blocked && clear < THRESHOLDS.pathClear) {
    return { state: 'unknown', frameSeq, reason: 'Not sure about the path ahead.' };
  }

  const steer = resolveSteer({
    modelSteer: confidentChoice(answers, 'steer'),
    blocked,
    facingWall,
    position,
    leftOpen,
    rightOpen,
  });

  const base = { state: 'ok' as const, frameSeq, assessedAt: now, people, openSide, steer, facingWall };

  if (!blocked) {
    return { ...base, spokenSummary: STEER_PHRASE.straight, hazards: [], clearOfVisibleObstacles: true, alertKey: 'clear' };
  }

  const label = facingWall
    ? 'wall_or_door'
    : kindChoice && kindChoice !== 'none'
      ? kindChoice
      : people === 'group' || people === 'crowd'
        ? 'group_of_people'
        : 'other';
  const isPeople = label === 'person_standing' || label === 'group_of_people';
  const hazardPosition: PathPosition = facingWall ? 'center' : position;
  const hazard: VisionHazard = {
    kind: isPeople ? 'people' : 'fixed',
    label,
    direction:
      hazardPosition === 'left_part'
        ? 'slight_left'
        : hazardPosition === 'right_part'
          ? 'slight_right'
          : hazardPosition === 'center'
            ? 'ahead'
            : 'unclear',
    proximity: facingWall ? 'near' : proximity(answers),
    position: hazardPosition,
  };

  // Direction first, then what and where: "Veer right. Bag on the floor on the left of your path, close."
  const what = facingWall
    ? 'Wall or door ahead.'
    : `${LABEL_PHRASE[label] ?? 'Obstacle'} ${POSITION_PHRASE[hazardPosition]}${howFar(hazard.proximity)}.`;
  const spokenSummary = steer === 'unclear' ? what : `${STEER_PHRASE[steer]} ${what}`;

  return {
    ...base,
    spokenSummary,
    hazards: [hazard],
    // A single person standing still is confirmed over two fresh frames on the phone.
    standingPerson: label === 'person_standing' ? (hazard.proximity === 'near' ? 'close_ahead' : 'in_front') : undefined,
    clearOfVisibleObstacles: false,
    alertKey: `${hazard.kind}:${label}:${hazardPosition}:${steer}`,
  };
}

/** Instructions for describing an obstacle that has stayed in view (Responses API, image input). */
export const DESCRIBE_INSTRUCTIONS =
  'You help a blind person who has stopped in front of something while walking through a conference venue. ' +
  'In at most 14 words, say what the main obstacle in the middle of the photo is and where it is ' +
  '(for example "A backpack on the floor ahead, slightly right of center."). ' +
  'Plain words, no preamble, never say it is safe to proceed.';
