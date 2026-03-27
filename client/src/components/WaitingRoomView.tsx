import { Minus, Plus, SlidersHorizontal } from 'lucide-react';
import type { RoomState } from '../types';

type WaitingRoomViewProps = {
  room: RoomState;
  lobbyMatchCount: number;
  onAdjustMatchCount: (delta: number) => void;
  onAdjustCivilianCount: (delta: number) => void;
  onAdjustUndercoverCount: (delta: number) => void;
  onAdjustMisterWhiteCount: (delta: number) => void;
  onToggleMisterWhite: () => void;
  onToggleLovers: () => void;
  onToggleJudge: () => void;
  onToggleSeer: () => void;
  onApplySettings: () => void;
  onStartGame: () => void;
};

export function WaitingRoomView({
  room,
  lobbyMatchCount,
  onAdjustMatchCount,
  onAdjustCivilianCount,
  onAdjustUndercoverCount,
  onAdjustMisterWhiteCount,
  onToggleMisterWhite,
  onToggleLovers,
  onToggleJudge,
  onToggleSeer,
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
              <small>Civils</small>
              <p>{room.civilianCountSetting}</p>
            </div>
            <div className="stepper">
              <button
                className="stepper-btn"
                type="button"
                onClick={() => onAdjustCivilianCount(-1)}
              >
                <Minus size={16} />
              </button>
              <button
                className="stepper-btn"
                type="button"
                onClick={() => onAdjustCivilianCount(1)}
              >
                <Plus size={16} />
              </button>
            </div>
          </div>

          <div className="setting-tile">
            <div>
              <small>Undercovers</small>
              <p>{room.undercoverCountSetting}</p>
            </div>
            <div className="stepper">
              <button
                className="stepper-btn"
                type="button"
                onClick={() => onAdjustUndercoverCount(-1)}
              >
                <Minus size={16} />
              </button>
              <button
                className="stepper-btn"
                type="button"
                onClick={() => onAdjustUndercoverCount(1)}
              >
                <Plus size={16} />
              </button>
            </div>
          </div>

          <div className="setting-tile">
            <div>
              <small>Mister White</small>
              <p>{room.misterWhiteCountSetting}</p>
            </div>
            <div className="stepper">
              <button
                className="stepper-btn"
                type="button"
                onClick={() => onAdjustMisterWhiteCount(-1)}
                disabled={!room.enableMisterWhite}
              >
                <Minus size={16} />
              </button>
              <button
                className="stepper-btn"
                type="button"
                onClick={() => onAdjustMisterWhiteCount(1)}
                disabled={!room.enableMisterWhite}
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
            <button
              className={`special-role-toggle ${room.enableJudge ? 'active' : ''}`}
              type="button"
              onClick={onToggleJudge}
            >
              <img src={withBase('/juge.png')} alt="Juge" />
              <span>Juge</span>
            </button>
          </div>
          <div className="special-roles-grid special-roles-grid-secondary">
            <button
              className={`special-role-toggle ${room.enableSeer ? 'active' : ''}`}
              type="button"
              onClick={onToggleSeer}
            >
              <img src={withBase('/boulemagique.png')} alt="Voyante" />
              <span>Voyante</span>
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
