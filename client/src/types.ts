export type Player = {
  id: string;
  name: string;
  isHost: boolean;
  avatarUrl: string;
  score: number;
  isAlive: boolean;
  isJudge?: boolean;
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
  undercoverIds?: string[];
  misterWhiteId?: string | null;
  misterWhiteName?: string | null;
  misterWhiteIds?: string[];
  suspectedId: string | null;
  suspectedName: string | null;
  undercoverCaught: boolean;
  winnerTeam?: 'civilians' | 'undercovers';
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
  phase: 'lobby' | 'clues' | 'voting' | 'misterwhite_guess' | 'ended';
  round: number;
  totalManches: number;
  currentManche: number;
  sessionFinished: boolean;
  aliveCount: number;
  players: Player[];
  clues: Clue[];
  currentSpeakerId: string | null;
  clueTurnEndsAt: number | null;
  votesCount: number;
  requiredVotes: number;
  canStart: boolean;
  canSubmitClue: boolean;
  canSubmitMisterWhiteGuess: boolean;
  isHost: boolean;
  enableMisterWhite: boolean;
  enableLovers: boolean;
  enableJudge?: boolean;
  civilianCountSetting: number;
  undercoverCountSetting: number;
  misterWhiteCountSetting: number;
  selfIsMisterWhite: boolean;
  selfWord?: string | null;
  selfLoverName: string | null;
  selfIsAlive: boolean;
  selfId: string;
  hasVoted: boolean;
  pendingMisterWhiteGuess: {
    playerId: string;
    playerName: string;
  } | null;
  lastMisterWhiteGuess: {
    playerId: string;
    guess: string;
    correct: boolean;
    targetWord: string;
  } | null;
  lastVoteMessage: string | null;
  canNextManche: boolean;
  selfAvatarExpiresAt: number | null;
  result?: Result;
};

export type RoleInfo = {
  word: string | null;
};

export type Ack = {
  ok: boolean;
  error?: string;
  roomCode?: string;
  sessionToken?: string;
};

export type UploadResponse = {
  ok: boolean;
  error?: string;
};
