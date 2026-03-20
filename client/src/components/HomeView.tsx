import type { ChangeEvent } from 'react';
import { Shuffle, Upload } from 'lucide-react';

type HomeViewProps = {
  profilePreview: string;
  playerName: string;
  joinCode: string;
  onPlayerNameChange: (value: string) => void;
  onJoinCodeChange: (value: string) => void;
  onRandomAvatar: () => void;
  onAvatarFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onCreateRoom: () => void;
  onJoinRoom: () => void;
};

export function HomeView({
  profilePreview,
  playerName,
  joinCode,
  onPlayerNameChange,
  onJoinCodeChange,
  onRandomAvatar,
  onAvatarFileChange,
  onCreateRoom,
  onJoinRoom
}: HomeViewProps) {
  return (
    <section className="simple-grid">
      <article className="box profile-box">
        <h2>Profil</h2>
        <img className="avatarPreview" src={profilePreview} alt="Apercu avatar" />
        <div className="profile-actions">
          <button className="secondary-btn" type="button" onClick={onRandomAvatar}>
            <span className="btn-icon" aria-hidden="true"><Shuffle /></span>
            <span>Aléatoire</span>
          </button>
          <label className="uploadBtn uploadBtnStrong">
            <span className="btn-icon" aria-hidden="true"><Upload /></span>
            Importer
            <input type="file" accept="image/*" onChange={onAvatarFileChange} />
          </label>
        </div>
      </article>

      <article className="box">
        <h2>Room</h2>
        <label htmlFor="name">Pseudo</label>
        <input
          id="name"
          placeholder="Username"
          value={playerName}
          onChange={(event) => onPlayerNameChange(event.target.value)}
          maxLength={18}
        />
        <button className="primary" type="button" onClick={onCreateRoom}>Creer une room</button>

        <label htmlFor="code">Code room (4 chiffres)</label>
        <input
          id="code"
          placeholder="Ex: 0427"
          value={joinCode}
          onChange={(event) => onJoinCodeChange(event.target.value.replace(/\D/g, '').slice(0, 4))}
          maxLength={4}
        />
        <button type="button" onClick={onJoinRoom}>Rejoindre room</button>
      </article>
    </section>
  );
}
