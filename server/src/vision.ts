import type { VisionAssessment } from '../../shared/contracts.ts';
import type { DecisionAnswer, DecisionQuestion, DecisionsRequest } from './openai.ts';

/**
 * Obstacle assessment via OpenAI Decisions. The model answers fixed questions
 * with probabilities; we map them to a conservative, speakable result.
 *
 * Safety stance: we only ever claim "no obstacles DETECTED IN VIEW", never that
 * a path is safe. Low-confidence or unclear frames return `unknown`.
 */

const CONTEXT =
  'This photo is from a phone camera held at chest height by a blind or low-vision person walking ' +
  'through a conference venue. "The walking path" means the floor area directly ahead, about one ' +
  'body-width wide, up to roughly 4 meters away.';

export const VISION_QUESTIONS: DecisionQuestion[] = [
  {
    type: 'predicate',
    name: 'image_usable',
    instructions:
      'Is the image clear enough to judge the walking path? Answer false if it is very blurry, too dark, ' +
      'covered by a finger, or pointed at the ceiling or the floor right at the feet.',
  },
  {
    type: 'predicate',
    name: 'obstacle_in_path',
    instructions:
      'Is there a visible obstacle in or partly in the walking path within about 4 meters, such as a ' +
      'person, chair, table, sign, stanchion, bag, step, stairs, wall, closed door, or column?',
  },
  {
    type: 'choice',
    name: 'obstacle_kind',
    instructions: 'What is the nearest obstacle in or near the walking path?',
    choices: [
      { value: 'person', description: 'One or more people standing or walking.' },
      { value: 'furniture', description: 'Chair, table, bench, booth counter, or cart.' },
      { value: 'step_or_stairs', description: 'A step, curb, stairs, or escalator edge.' },
      { value: 'wall_or_door', description: 'A wall, closed door, glass panel, or column.' },
      { value: 'sign_or_barrier', description: 'Sign stand, stanchion, rope, or barrier.' },
      { value: 'small_object', description: 'Bag, box, cable, or other object on the floor.' },
      { value: 'other', description: 'Some other obstacle.' },
      { value: 'none', description: 'No obstacle is visible.' },
    ],
  },
  {
    type: 'choice',
    name: 'obstacle_direction',
    instructions: 'Where is the nearest obstacle relative to the walking path?',
    choices: [
      { value: 'left', description: 'Mostly on the left side of the path.' },
      { value: 'ahead', description: 'Directly in the middle of the path.' },
      { value: 'right', description: 'Mostly on the right side of the path.' },
      { value: 'none', description: 'No obstacle is visible.' },
    ],
  },
  {
    type: 'score',
    name: 'obstacle_distance',
    instructions: 'How far away is the nearest obstacle in or near the walking path?',
    levels: [
      { label: 'near', description: 'Within about 1 meter, a step or two away.' },
      { label: 'mid', description: 'About 1 to 3 meters away.' },
      { label: 'far', description: 'More than about 3 meters away, or none visible.' },
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
  obstacleYes: 0.6,
  obstacleNo: 0.2,
  choiceConfidence: 0.4,
};

const KIND_PHRASE: Record<string, string> = {
  person: 'Person',
  furniture: 'Furniture',
  step_or_stairs: 'Step or stairs',
  wall_or_door: 'Wall or door',
  sign_or_barrier: 'Sign or barrier',
  small_object: 'Object on the floor',
  other: 'Obstacle',
};

function find<T extends DecisionAnswer['type']>(answers: DecisionAnswer[], name: string, type: T) {
  return answers.find((a): a is Extract<DecisionAnswer, { type: T }> => a.name === name && a.type === type);
}

export function mapVisionAnswers(answers: DecisionAnswer[], frameSeq: number, now = Date.now()): VisionAssessment {
  const usable = find(answers, 'image_usable', 'predicate');
  const obstacle = find(answers, 'obstacle_in_path', 'predicate');
  if (!usable || !obstacle) return { state: 'unknown', frameSeq, reason: 'Incomplete answer from the AI service.' };
  if (usable.probability < THRESHOLDS.usable) {
    return { state: 'unknown', frameSeq, reason: 'Camera view unclear. Hold the phone upright, facing ahead.' };
  }

  if (obstacle.probability <= THRESHOLDS.obstacleNo) {
    return {
      state: 'ok',
      frameSeq,
      assessedAt: now,
      spokenSummary: 'No obstacles detected in view.',
      hazards: [],
      clearOfVisibleObstacles: true,
    };
  }
  if (obstacle.probability < THRESHOLDS.obstacleYes) {
    return { state: 'unknown', frameSeq, reason: 'Not sure about the path ahead.' };
  }

  const kind = find(answers, 'obstacle_kind', 'choice');
  const dir = find(answers, 'obstacle_direction', 'choice');
  const dist = find(answers, 'obstacle_distance', 'score');

  const kindValue = kind && kind.confidence >= THRESHOLDS.choiceConfidence && kind.choice !== 'none' ? kind.choice : 'other';
  const direction =
    dir && dir.confidence >= THRESHOLDS.choiceConfidence && dir.choice !== 'none'
      ? (dir.choice as 'left' | 'ahead' | 'right')
      : 'unclear';
  // score is the expected level index (0=near, 1=mid, 2=far).
  const proximity =
    dist && dist.confidence >= THRESHOLDS.choiceConfidence
      ? dist.score < 0.67
        ? 'near'
        : dist.score < 1.5
          ? 'mid'
          : 'far'
      : 'unclear';

  const where = direction === 'ahead' ? 'ahead' : direction === 'unclear' ? 'nearby' : `on the ${direction}`;
  const howFar = proximity === 'near' ? ', close' : proximity === 'mid' ? ', a few steps away' : '';
  return {
    state: 'ok',
    frameSeq,
    assessedAt: now,
    spokenSummary: `${KIND_PHRASE[kindValue] ?? 'Obstacle'} ${where}${howFar}.`,
    hazards: [{ label: kindValue, direction, proximity }],
    clearOfVisibleObstacles: false,
  };
}
