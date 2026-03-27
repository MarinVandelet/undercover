import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { FastForward, Volume2, VolumeX } from 'lucide-react';
import type { Clue, RoomState, RoleInfo } from '../types';

const BASE_URL = import.meta.env.BASE_URL || '/';
function withBase(pathname: string) {
  const clean = pathname.replace(/^\/+/, '');
  return `${BASE_URL}${clean}`;
}

type GameViewProps = {
  room: RoomState;
  roleInfo: RoleInfo | null;
  currentSpeakerName: string | null;
  previousClue: Clue | null;
  clueText: string;
  setClueText: (value: string) => void;
  onSubmitClue: (event: FormEvent) => void;
  misterWhiteGuessText: string;
  setMisterWhiteGuessText: (value: string) => void;
  onSubmitMisterWhiteGuess: (event: FormEvent) => void;
  clueTimeLeft: number;
  clueProgressPercent: number;
  selfId: string;
  cluesByPlayer: Map<string, Clue[]>;
  onVote: (targetId: string) => void;
  onForceVoting: () => void;
  onSkipVote: () => void;
  onSkipManche: () => void;
  onNextManche: () => void;
  onBackToLobby: () => void;
  onUseSeerPower: (targetId: string) => void;
  audioEnabled: boolean;
  onToggleAudio: () => void;
  audioVolume: number;
  onChangeAudioVolume: (value: number) => void;
  onQuitToHome: () => void;
};

export function GameView({
  room,
  roleInfo,
  currentSpeakerName,
  previousClue,
  clueText,
  setClueText,
  onSubmitClue,
  misterWhiteGuessText,
  setMisterWhiteGuessText,
  onSubmitMisterWhiteGuess,
  clueTimeLeft,
  clueProgressPercent,
  selfId,
  cluesByPlayer,
  onVote,
  onForceVoting,
  onSkipVote,
  onSkipManche,
  onNextManche,
  onBackToLobby,
  onUseSeerPower,
  audioEnabled,
  onToggleAudio,
  audioVolume,
  onChangeAudioVolume,
  onQuitToHome
}: GameViewProps) {
  const [selectedVoteId, setSelectedVoteId] = useState('');
  const [lastConfirmedVoteId, setLastConfirmedVoteId] = useState('');
  const [selectedSeerTargetId, setSelectedSeerTargetId] = useState('');
  const roundPoints = new Map<string, number>();
  const hasUndercover =
    (room.result?.undercoverIds && room.result.undercoverIds.length > 0)
    || Boolean(room.result?.undercoverId);
  (room.result?.pointsAwarded || []).forEach((award) => {
    roundPoints.set(award.playerId, (roundPoints.get(award.playerId) || 0) + award.points);
  });

  useEffect(() => {
    if (room.phase !== 'voting') {
      setSelectedVoteId('');
      setLastConfirmedVoteId('');
    }
  }, [room.phase, room.roomCode]);

  useEffect(() => {
    if (!room.canUseSeerPower) {
      setSelectedSeerTargetId('');
    }
  }, [room.canUseSeerPower, room.roomCode, room.phase]);

  function submitVote(event: FormEvent) {
    event.preventDefault();
    if (!selectedVoteId) return;
    setLastConfirmedVoteId(selectedVoteId);
    onVote(selectedVoteId);
  }
  const voteChangePending =
    room.hasVoted && Boolean(selectedVoteId) && selectedVoteId !== lastConfirmedVoteId;

  const densityClass =
    room.players.length <= 4 ? 'density-large' : room.players.length <= 7 ? 'density-medium' : 'density-compact';

  return (
    <main className="clue-fullscreen">
      <div className="clue-progress-wrap">
        <div className="clue-progress-bar" style={{ width: `${clueProgressPercent}%` }} />
      </div>

      <header className="clue-topbar">
        <div className="clue-top-left">
          <button className="logo-home-btn" type="button" onClick={onQuitToHome} title="Quitter la partie">
            <img className="clue-header-logo" src={withBase('/logo_blanc.png')} alt="Undercover" />
          </button>
        </div>
        <div className="clue-word-hero" aria-live="polite">
          {room.phase === 'ended' ? (
            <div className="result-hero">
              {hasUndercover ? (
                <>
                  <p className="undercover-line"><strong>Undercover:</strong> {room.result?.undercoverName || 'Inconnu'}</p>
                  <p className="undercover-line"><strong>Mot undercover:</strong> {room.result?.undercoverWord || '-'}</p>
                </>
              ) : (
                <p className="undercover-line"><strong>Mister White:</strong> {room.result?.misterWhiteName || 'Aucun'}</p>
              )}
              <p className="civil-line"><strong>Mot civil:</strong> {room.result?.civilianWord || '-'}</p>
            </div>
          ) : (
            <div className="in-game-role-wrap">
              {room.selfIsMisterWhite ? (
                <img className="mister-white-word-logo" src={withBase('/logo_blanc.png')} alt="Mister White" />
              ) : (
                <span>{roleInfo?.word || '...'}</span>
              )}
              {room.selfLoverName ? (
                <p className="lovers-hint">Vous êtes en couple avec {room.selfLoverName}</p>
              ) : null}
              {room.selfIsSeer ? (
                <p className="seer-hint">Vous etes la voyante 🔮</p>
              ) : null}
            </div>
          )}
        </div>
        <div className="clue-meta">
          {room.phase === 'clues' ? <span>{clueTimeLeft}s</span> : null}
          <span>
            {room.phase === 'clues'
              ? `Tour: ${currentSpeakerName || '...'}`
              : room.phase === 'voting'
                ? 'Vote en cours'
                : room.phase === 'misterwhite_guess'
                  ? 'Mister White devine'
                : 'Manche terminee'}
          </span>
          <span>Votes: {room.votesCount}/{room.requiredVotes}</span>
          {room.isHost && room.phase === 'clues' ? (
            <button className="force-vote-btn" type="button" onClick={onForceVoting}>
              <FastForward size={16} />
              <span>Passer au vote</span>
            </button>
          ) : null}
          {room.isHost && room.phase === 'voting' ? (
            <button className="force-vote-btn" type="button" onClick={onSkipVote}>
              <FastForward size={16} />
              <span>Skip vote</span>
            </button>
          ) : null}
          {room.isHost && (room.phase === 'clues' || room.phase === 'voting' || room.phase === 'misterwhite_guess') ? (
            <button className="force-vote-btn" type="button" onClick={onSkipManche}>
              <FastForward size={16} />
              <span>Passer la manche</span>
            </button>
          ) : null}
          <div className={`audio-tools ${audioEnabled ? 'is-on' : 'is-off'}`}>
            <button
              className="audio-toggle-btn"
              type="button"
              onClick={onToggleAudio}
              aria-label={audioEnabled ? 'Couper le son' : 'Activer le son'}
              title={audioEnabled ? 'Son ON' : 'Son OFF'}
            >
              {audioEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </button>
            {audioEnabled ? (
              <input
                className="audio-range"
                type="range"
                min={0}
                max={100}
                step={1}
                value={audioVolume}
                onChange={(event) => onChangeAudioVolume(Number(event.target.value))}
                aria-label="Volume"
              />
            ) : null}
          </div>
        </div>
      </header>

      <section className={`clue-users-top ${densityClass}`}>
        {room.players.map((player) => {
          const entries = cluesByPlayer.get(player.id) || [];
          return (
            <article
              className={`clue-user-card ${player.id === room.currentSpeakerId ? 'active-turn' : ''} ${player.id === selfId ? 'me' : ''} ${player.isAlive ? '' : 'eliminated'}`}
              key={player.id}
            >
              <img className="clue-player-avatar" src={player.avatarUrl} alt={`Avatar ${player.name}`} />
              <h3 className="clue-player-name">
                <span>{player.name}</span>
                {player.isJudge ? (
                  <img className="judge-badge-img" src={withBase('/juge.png')} alt="Juge" />
                ) : null}
              </h3>
              <div className="clue-user-words">
                {!player.isAlive ? <p className="empty-word">Eliminé</p> : null}
                {entries.length === 0 && player.isAlive && <p className="empty-word">Aucun mot</p>}
                {entries.map((clue) => (
                  <p key={clue.id}>{clue.text}</p>
                ))}
              </div>
            </article>
          );
        })}
      </section>

      <footer className="clue-input-dock">
        <div className="clue-input-card">
          {room.phase === 'clues' ? (
            <>
              {room.lastVoteMessage ? (
                <p className="mister-white-feedback">{room.lastVoteMessage}</p>
              ) : null}
              {room.lastMisterWhiteGuess && !room.lastMisterWhiteGuess.correct ? (
                <p className="mister-white-feedback">
                  Mister White ({room.players.find((p) => p.id === room.lastMisterWhiteGuess?.playerId)?.name || 'Inconnu'})
                  {' '}n'a pas trouve le mot.
                </p>
              ) : null}
              <p>Indice précédent: {previousClue ? `${previousClue.playerName}: ${previousClue.text}` : 'Aucun'}</p>
              {room.canSubmitClue ? (
                <form onSubmit={onSubmitClue} className="clue-dock-form">
                  <input
                    placeholder="Tape ton mot indice"
                    value={clueText}
                    onChange={(event) => setClueText(event.target.value)}
                    maxLength={80}
                  />
                  <button className="primary" type="submit">Envoyer</button>
                </form>
              ) : !room.selfIsAlive ? (
                <p>Tu es eliminé: tu observes la manche.</p>
              ) : (
                <p>Attends ton tour, passage auto a la fin du chrono.</p>
              )}
              {room.canUseSeerPower ? (
                <div className="seer-panel">
                  <p className="seer-title">Voyante: choisis un joueur avant le premier vote.</p>
                  <div className="vote-pick-grid">
                    {room.players
                      .filter((player) => player.id !== selfId && player.isAlive)
                      .map((player) => (
                        <button
                          key={`seer-${player.id}`}
                          type="button"
                          className={`vote-pick-btn ${selectedSeerTargetId === player.id ? 'selected' : ''}`}
                          onClick={() => setSelectedSeerTargetId(player.id)}
                        >
                          <img className="avatarMini" src={player.avatarUrl} alt={`Avatar ${player.name}`} />
                          <span>{player.name}</span>
                        </button>
                      ))}
                  </div>
                  <button
                    className="primary"
                    type="button"
                    disabled={!selectedSeerTargetId}
                    onClick={() => {
                      if (!selectedSeerTargetId) return;
                      onUseSeerPower(selectedSeerTargetId);
                    }}
                  >
                    Utiliser voyance
                  </button>
                </div>
              ) : null}
              {room.selfIsSeer && room.seerInsight ? (
                <p className="seer-feedback">{room.seerInsight}</p>
              ) : null}
            </>
          ) : room.phase === 'voting' ? (
            <form onSubmit={submitVote} className="vote-dock-form">
              <p>Choisis un joueur puis confirme ton vote.</p>
              <div className="vote-pick-grid">
                {room.players
                  .filter((player) => player.id !== selfId && player.isAlive)
                  .map((player) => (
                    <button
                      key={player.id}
                      type="button"
                      className={`vote-pick-btn ${selectedVoteId === player.id ? 'selected' : ''}`}
                      onClick={() => setSelectedVoteId(player.id)}
                      disabled={player.id === selfId}
                    >
                      <img className="avatarMini" src={player.avatarUrl} alt={`Avatar ${player.name}`} />
                      <span>{player.name}</span>
                    </button>
                  ))}
              </div>
              {room.hasVoted ? (
                <div className="vote-actions-split">
                  <button className="vote-state-btn" type="button" disabled>
                    {voteChangePending ? 'Vote non confirme' : 'Vote confirme'}
                  </button>
                  <button
                    className="primary vote-state-btn vote-change-btn"
                    type="submit"
                    disabled={!selectedVoteId || !room.selfIsAlive || selectedVoteId === lastConfirmedVoteId}
                  >
                    Changer de vote
                  </button>
                </div>
              ) : (
                <button className="primary" type="submit" disabled={!selectedVoteId || !room.selfIsAlive}>
                  Confirmer mon vote
                </button>
              )}
              {!room.selfIsAlive ? <p>Tu es elimine: tu ne peux plus voter.</p> : null}
            </form>
          ) : room.phase === 'misterwhite_guess' ? (
            room.canSubmitMisterWhiteGuess ? (
              <form onSubmit={onSubmitMisterWhiteGuess} className="vote-dock-form">
                <p>Tu es Mister White: tente de deviner le mot civil.</p>
                <input
                  placeholder="Ton mot..."
                  value={misterWhiteGuessText}
                  onChange={(event) => setMisterWhiteGuessText(event.target.value)}
                  maxLength={80}
                />
                <button className="primary" type="submit" disabled={!misterWhiteGuessText.trim()}>
                  Valider le mot
                </button>
              </form>
            ) : (
              <div>
                <p>{room.pendingMisterWhiteGuess?.playerName || 'Mister White'} tente de deviner le mot...</p>
                {room.lastMisterWhiteGuess ? (
                  <p>
                    Proposition: <strong>{room.lastMisterWhiteGuess.guess}</strong>{' '}
                    ({room.lastMisterWhiteGuess.correct ? 'correct' : 'incorrect'})
                  </p>
                ) : null}
              </div>
            )
          ) : (
            <div className="round-result-panel">
              <h3>Resultat de manche</h3>
              {room.result?.reason ? <p>{room.result.reason}</p> : null}
              <p>
                Vote final: <strong>{room.result?.suspectedName || 'Aucun'}</strong>
              </p>
              <p>
                {!hasUndercover
                  ? 'Pas d\'undercover dans cette manche (mode Mister White)'
                  : room.result?.undercoverCaught
                    ? 'Undercover demasque'
                    : 'Undercover gagnant'}
              </p>

              <div className="scoreboard-grid">
                {(room.result?.scoreBoard || [])
                  .slice()
                  .sort((a, b) => b.score - a.score)
                  .map((entry) => (
                    <div className="score-row" key={entry.playerId}>
                      <span>{entry.playerName}</span>
                      <div className="score-right">
                        {roundPoints.get(entry.playerId) ? (
                          <span className="score-gain">+{roundPoints.get(entry.playerId)}</span>
                        ) : null}
                        <strong>{entry.score}</strong>
                      </div>
                    </div>
                  ))}
              </div>

              {room.isHost ? (
                <div className="result-actions">
                  {!room.sessionFinished && room.canNextManche ? (
                    <button className="primary" type="button" onClick={onNextManche}>
                      Passer a la prochaine manche
                    </button>
                  ) : null}
                  <button type="button" onClick={onBackToLobby}>
                    Retour au lobby
                  </button>
                </div>
              ) : (
                <p className="waiting-host-text">En attente de l'hôte pour la suite.</p>
              )}
            </div>
          )}
        </div>
      </footer>
    </main>
  );
}
