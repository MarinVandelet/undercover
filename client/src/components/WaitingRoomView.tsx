import { Minus, Plus, SlidersHorizontal } from 'lucide-react';
import type { RoomState } from '../types';

type WaitingRoomViewProps = {
  room: RoomState;
  lobbyMatchCount: number;
  lobbyWordRounds: number;
  onAdjustMatchCount: (delta: number) => void;
  onAdjustWordRounds: (delta: number) => void;
  onToggleMisterWhite: () => void;
  onToggleLovers: () => void;
  onApplySettings: () => void;
  onStartGame: () => void;
};

export function WaitingRoomView({
  room,
  lobbyMatchCount,
  lobbyWordRounds,
  onAdjustMatchCount,
  onAdjustWordRounds,
  onToggleMisterWhite,
  onToggleLovers,
  onApplySettings,
  onStartGame
}: WaitingRoomViewProps) {
  const baseUrl = import.meta.env.BASE_URL || '/';
  const withBase = (pathname: string) => `${baseUrl}${pathname.replace(/^\/+/, '')}`;

  return (
    <div className="phase-box">
      <h3>Waiting room</h3>
      {room.isHost ? (
        <div className="settings-panel">
          <div className="setting-tile">
            <div>
              <small>Manches</small>
              <p>{lobbyMatchCount}</p>
            </div>
            <div className="stepper">
              <button
                className="stepper-btn"
                type="button"
                onClick={() => onAdjustMatchCount(-1)}
              >
                <Minus size={16} />
              </button>
              <button
                className="stepper-btn"
                type="button"
                onClick={() => onAdjustMatchCount(1)}
              >
                <Plus size={16} />
              </button>
            </div>
          </div>

          <div className="setting-tile">
            <div>
              <small>Tours de mots</small>
              <p>{lobbyWordRounds}</p>
            </div>
            <div className="stepper">
              <button
                className="stepper-btn"
                type="button"
                onClick={() => onAdjustWordRounds(-1)}
              >
                <Minus size={16} />
              </button>
              <button
                className="stepper-btn"
                type="button"
                onClick={() => onAdjustWordRounds(1)}
              >
                <Plus size={16} />
              </button>
            </div>
          </div>

          <button className="apply-settings-btn" type="button" onClick={onApplySettings}>
            <SlidersHorizontal size={16} />
            <span>Enregistrer les reglages</span>
          </button>

          <div className="special-roles-grid">
            <button
              className={`special-role-toggle ${room.enableMisterWhite ? 'active' : ''}`}
              type="button"
              onClick={onToggleMisterWhite}
            >
              <img src={withBase('/logo_blanc.png')} alt="Mister White" />
              <span>Mister White</span>
            </button>
            <button
              className={`special-role-toggle ${room.enableLovers ? 'active' : ''}`}
              type="button"
              onClick={onToggleLovers}
            >
              <img src={withBase('/coeur.png')} alt="Amoureux" />
              <span>Amoureux</span>
            </button>
          </div>
        </div>
      ) : null}

      <button
        className="primary"
        type="button"
        onClick={onStartGame}
        disabled={!room.isHost || room.players.length < 3}
      >
        Commencer la partie
      </button>
    </div>
  );
}
