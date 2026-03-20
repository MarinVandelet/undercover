import { Minus, Plus, SlidersHorizontal } from 'lucide-react';
import type { RoomState } from '../types';

type WaitingRoomViewProps = {
  room: RoomState;
  lobbyMatchCount: number;
  lobbyWordRounds: number;
  onAdjustMatchCount: (delta: number) => void;
  onAdjustWordRounds: (delta: number) => void;
  onApplySettings: () => void;
  onStartGame: () => void;
};

export function WaitingRoomView({
  room,
  lobbyMatchCount,
  lobbyWordRounds,
  onAdjustMatchCount,
  onAdjustWordRounds,
  onApplySettings,
  onStartGame
}: WaitingRoomViewProps) {
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
