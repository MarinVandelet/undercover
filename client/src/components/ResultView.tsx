import type { RoomState } from '../types';

type ResultViewProps = {
  room: RoomState;
  onBackToLobby: () => void;
};

export function ResultView({ room, onBackToLobby }: ResultViewProps) {
  if (!room.result) return null;

  return (
    <div className="phase-box">
      <h3>Resultat</h3>
      {room.result.reason ? <p>{room.result.reason}</p> : null}
      <p>Undercover: <strong>{room.result.undercoverName || 'Unknown'}</strong></p>
      <p>Accuse: <strong>{room.result.suspectedName || 'Aucun'}</strong></p>
      <p>{room.result.undercoverCaught ? 'Victoire civils' : 'Victoire undercover'}</p>
      <p>Mot civil: <strong>{room.result.civilianWord || '-'}</strong></p>
      <p>Mot undercover: <strong>{room.result.undercoverWord || '-'}</strong></p>
      {room.isHost && (
        <button type="button" onClick={onBackToLobby}>
          {room.sessionFinished ? 'Recommencer les manches' : 'Manche suivante'}
        </button>
      )}
    </div>
  );
}
