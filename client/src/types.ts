export type Player = {
  id: string;
  name: string;
  isHost: boolean;
  avatarUrl: string;
  score: number;
};

export type Clue = {
  id: string;
  round: number;
  playerId: string;
  playerName: string;
  text: string;
};

export type Result = {
  undercoverId: string | null;
  undercoverName: string | null;
  suspectedId: string | null;
  suspectedName: string | null;
  undercoverCaught: boolean;
  civilianWord: string | null;
  undercoverWord: string | null;
  pointsAwarded?: {
    playerId: string;
    playerName: string;
    points: number;
    reason: string;
    totalScore: number;
  }[];
  scoreBoard?: {
    playerId: string;
    playerName: string;
    score: number;
  }[];
  voteBreakdown?: {
    voterId: string;
    voterName: string;
    targetId: string | null;
    targetName: string | null;
  }[];
  reason?: string;
};

export type RoomState = {
  roomCode: string;
  phase: 'lobby' | 'clues' | 'voting' | 'ended';
  round: number;
  maxRounds: number;
  totalManches: number;
  currentManche: number;
  sessionFinished: boolean;
  wordRounds: number;
  players: Player[];
  clues: Clue[];
  currentSpeakerId: string | null;
  clueTurnEndsAt: number | null;
  votesCount: number;
  requiredVotes: number;
  canStart: boolean;
  canSubmitClue: boolean;
  isHost: boolean;
  selfId: string;
  hasVoted: boolean;
  canNextManche: boolean;
  selfAvatarExpiresAt: number | null;
  result?: Result;
};

export type RoleInfo = {
  word: string;
};

export type Ack = {
  ok: boolean;
  error?: string;
  roomCode?: string;
};

export type UploadResponse = {
  ok: boolean;
  error?: string;
};
