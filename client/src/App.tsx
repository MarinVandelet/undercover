import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { Copy, DoorOpen, Shuffle, Trash2, Upload } from 'lucide-react';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { GameView } from './components/GameView';
import { HomeView } from './components/HomeView';
import { WaitingRoomView } from './components/WaitingRoomView';
import type { Ack, Clue, Player, RoleInfo, RoomState, UploadResponse } from './types';

const BASE_URL = import.meta.env.BASE_URL || '/';
const BASE_PATH = BASE_URL.endsWith('/') ? BASE_URL.slice(0, -1) : BASE_URL;
const SOCKET_PATH = `${BASE_PATH || ''}/socket.io`;

function withBase(pathname: string) {
  const clean = pathname.replace(/^\/+/, '');
  return `${BASE_URL}${clean}`;
}

const DEFAULT_AVATARS = [
  withBase('/avatars/user (1).png'),
  withBase('/avatars/user (2).png'),
  withBase('/avatars/user (3).png'),
  withBase('/avatars/user (4).png'),
  withBase('/avatars/user (5).png'),
  withBase('/avatars/user (6).png'),
  withBase('/avatars/user (7).png'),
  withBase('/avatars/user (8).png'),
  withBase('/avatars/user (9).png'),
  withBase('/avatars/user (10).png'),
  withBase('/avatars/user (11).png')
];

const socket: Socket = io({ autoConnect: true, path: SOCKET_PATH });
const CLUE_TURN_SECONDS = 25;
const AUDIO_PREFS_KEY = 'undercover_audio_prefs_v1';
const AUDIO_PREFS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PLAYER_NAME_KEY = 'undercover_player_name_v1';
const PLAYER_NAME_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function randomDefaultAvatar() {
  return DEFAULT_AVATARS[Math.floor(Math.random() * DEFAULT_AVATARS.length)];
}

function loadAudioPrefs() {
  const defaults = { audioEnabled: false, audioVolume: 35 };
  try {
    const raw = window.localStorage.getItem(AUDIO_PREFS_KEY);
    if (!raw) return defaults;

    const parsed = JSON.parse(raw) as {
      audioEnabled?: boolean;
      audioVolume?: number;
      expiresAt?: number;
    };

    if (!parsed.expiresAt || Date.now() > parsed.expiresAt) {
      window.localStorage.removeItem(AUDIO_PREFS_KEY);
      return defaults;
    }

    return {
      audioEnabled: Boolean(parsed.audioEnabled),
      audioVolume: Math.max(0, Math.min(100, Number(parsed.audioVolume ?? defaults.audioVolume)))
    };
  } catch (_error) {
    return defaults;
  }
}

function saveAudioPrefs(audioEnabled: boolean, audioVolume: number) {
  try {
    const payload = {
      audioEnabled,
      audioVolume: Math.max(0, Math.min(100, audioVolume)),
      expiresAt: Date.now() + AUDIO_PREFS_TTL_MS
    };
    window.localStorage.setItem(AUDIO_PREFS_KEY, JSON.stringify(payload));
  } catch (_error) {
    // no-op when storage is unavailable
  }
}

function loadSavedPlayerName() {
  try {
    const raw = window.localStorage.getItem(PLAYER_NAME_KEY);
    if (!raw) return '';
    const parsed = JSON.parse(raw) as {
      value?: string;
      expiresAt?: number;
    };
    if (!parsed.expiresAt || Date.now() > parsed.expiresAt) {
      window.localStorage.removeItem(PLAYER_NAME_KEY);
      return '';
    }
    return sanitizeName(parsed.value || '');
  } catch (_error) {
    return '';
  }
}

function savePlayerName(name: string) {
  const clean = sanitizeName(name);
  try {
    if (!clean) {
      window.localStorage.removeItem(PLAYER_NAME_KEY);
      return;
    }
    window.localStorage.setItem(
      PLAYER_NAME_KEY,
      JSON.stringify({
        value: clean,
        expiresAt: Date.now() + PLAYER_NAME_TTL_MS
      })
    );
  } catch (_error) {
    // no-op when storage is unavailable
  }
}

function sanitizeName(name: string) {
  return name.trim().replace(/\s+/g, ' ').slice(0, 18);
}

export default function App() {
  const [playerName, setPlayerName] = useState(() => loadSavedPlayerName());
  const [joinCode, setJoinCode] = useState('');
  const [clueText, setClueText] = useState('');
  const [room, setRoom] = useState<RoomState | null>(null);
  const [roleInfo, setRoleInfo] = useState<RoleInfo | null>(null);
  const [status, setStatus] = useState('Choisis un pseudo, puis crée ou rejoins une room.');
  const [selectedDefaultAvatar, setSelectedDefaultAvatar] = useState<string>(randomDefaultAvatar);
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null);
  const [pendingUploadPreview, setPendingUploadPreview] = useState<string | null>(null);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [copied, setCopied] = useState(false);
  const [lobbyMatchCount, setLobbyMatchCount] = useState(3);
  const [lobbyWordRounds, setLobbyWordRounds] = useState(3);
  const [nowTick, setNowTick] = useState(Date.now());
  const [audioEnabled, setAudioEnabled] = useState(() => loadAudioPrefs().audioEnabled);
  const [audioVolume, setAudioVolume] = useState(() => loadAudioPrefs().audioVolume);

  const audioContextRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const bgMusicRef = useRef<HTMLAudioElement | null>(null);

  const selfId = room?.selfId || socket.id || '';

  useEffect(() => {
    function onRoomUpdate(next: RoomState) {
      setRoom(next);
      setLobbyWordRounds(next.wordRounds);
      setLobbyMatchCount(next.totalManches);
      const me = next.players.find((p) => p.id === socket.id);
      if (me && DEFAULT_AVATARS.includes(me.avatarUrl)) {
        setSelectedDefaultAvatar(me.avatarUrl);
      }
    }

    function onRole(info: RoleInfo) {
      setRoleInfo(info);
      setStatus('Mot recu. La manche commence.');
    }

    function onRoomDeleted() {
      setRoom(null);
      setRoleInfo(null);
      setClueText('');
      setStatus('La room a ete supprimee.');
    }

    socket.on('room:update', onRoomUpdate);
    socket.on('game:role', onRole);
    socket.on('room:deleted', onRoomDeleted);

    return () => {
      socket.off('room:update', onRoomUpdate);
      socket.off('game:role', onRole);
      socket.off('room:deleted', onRoomDeleted);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 60);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const master = masterGainRef.current;
    if (!master) return;
    master.gain.value = audioEnabled ? audioVolume / 100 : 0;
  }, [audioEnabled, audioVolume]);

  useEffect(() => {
    saveAudioPrefs(audioEnabled, audioVolume);
  }, [audioEnabled, audioVolume]);

  useEffect(() => {
    savePlayerName(playerName);
  }, [playerName]);

  useEffect(() => {
    if (!bgMusicRef.current) {
      const audio = new Audio(withBase('/musique.mp3'));
      audio.loop = true;
      audio.preload = 'auto';
      bgMusicRef.current = audio;
    }
  }, []);

  useEffect(() => {
    const music = bgMusicRef.current;
    if (!music) return;
    music.volume = Math.max(0, Math.min(1, audioVolume / 100));
  }, [audioVolume]);

  useEffect(() => {
    const music = bgMusicRef.current;
    if (!music) return;

    const isInGame = room?.phase === 'clues' || room?.phase === 'voting' || room?.phase === 'ended';
    if (audioEnabled && isInGame) {
      void music.play().catch(() => {});
      return;
    }
    music.pause();
  }, [audioEnabled, room?.phase]);

  useEffect(() => {
    return () => {
      if (bgMusicRef.current) {
        bgMusicRef.current.pause();
        bgMusicRef.current.src = '';
        bgMusicRef.current = null;
      }
      if (audioContextRef.current) {
        void audioContextRef.current.close();
      }
    };
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1200);
    return () => window.clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    return () => {
      if (pendingUploadPreview) URL.revokeObjectURL(pendingUploadPreview);
    };
  }, [pendingUploadPreview]);

  function ensureAudioContext() {
    if (audioContextRef.current && masterGainRef.current) {
      return audioContextRef.current;
    }
    const AudioCtx = window.AudioContext
      || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;

    const ctx = new AudioCtx();
    const master = ctx.createGain();
    master.gain.value = audioEnabled ? audioVolume / 100 : 0;
    master.connect(ctx.destination);
    audioContextRef.current = ctx;
    masterGainRef.current = master;
    return ctx;
  }

  function playSubmitSfx() {
    const ctx = ensureAudioContext();
    if (!ctx) return;

    // Submit SFX is always audible, independent from the top-right music toggle.
    const playDirect = (
      frequency: number,
      durationMs: number,
      type: OscillatorType,
      volume: number,
      delaySec = 0
    ) => {
      const startAt = ctx.currentTime + delaySec;
      const endAt = startAt + durationMs / 1000;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();

      oscillator.type = type;
      oscillator.frequency.value = frequency;

      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), startAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, endAt);

      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(startAt);
      oscillator.stop(endAt + 0.02);
    };

    playDirect(880, 90, 'triangle', 0.22);
    playDirect(1175, 120, 'triangle', 0.18, 0.08);
  }

  async function toggleAudio() {
    const next = !audioEnabled;
    setAudioEnabled(next);
    if (!next) {
      setStatus('Son coupe.');
      return;
    }
    const ctx = ensureAudioContext();
    if (ctx && ctx.state === 'suspended') {
      await ctx.resume();
    }
    setStatus('Son active.');
  }

  function changeAudioVolume(nextValue: number) {
    setAudioVolume(Math.max(0, Math.min(100, nextValue)));
  }

  const playersById = useMemo(() => {
    const map = new Map<string, Player>();
    room?.players.forEach((p) => map.set(p.id, p));
    return map;
  }, [room]);

  const selfPlayer = room?.players.find((p) => p.id === selfId) || null;

  function emitAck(event: string, payload?: Record<string, unknown>): Promise<Ack> {
    return new Promise((resolve) => {
      if (payload) {
        socket.emit(event, payload, (ack: Ack) => resolve(ack));
      } else {
        socket.emit(event, (ack: Ack) => resolve(ack));
      }
    });
  }

  function validateName() {
    const trimmed = playerName.trim();
    if (!trimmed) {
      setStatus('Entre un pseudo valide.');
      return null;
    }
    if (trimmed.length > 18) {
      setStatus('Pseudo trop long (18 max).');
      return null;
    }
    return trimmed;
  }

  async function uploadAvatarNow(file: File) {
    if (!socket.id) {
      setStatus('Socket non pret, reessaie.');
      return;
    }

    setIsUploadingAvatar(true);
    try {
      const formData = new FormData();
      formData.append('avatar', file);
      formData.append('socketId', socket.id);

      const response = await fetch(withBase('/api/avatar/upload'), {
        method: 'POST',
        body: formData
      });
      const data = (await response.json()) as UploadResponse;

      if (!response.ok || !data.ok) {
        setStatus(data.error || 'Upload avatar refuse.');
        return;
      }

      if (pendingUploadPreview) URL.revokeObjectURL(pendingUploadPreview);
      setPendingUploadFile(null);
      setPendingUploadPreview(null);
      setStatus('Avatar importe. Suppression auto dans 20 minutes.');
    } catch (_error) {
      setStatus('Echec upload avatar.');
    } finally {
      setIsUploadingAvatar(false);
    }
  }

  async function createRoom() {
    const name = validateName();
    if (!name) return;

    const ack = await emitAck('room:create', { name, avatarUrl: selectedDefaultAvatar });
    if (!ack.ok) {
      setStatus(ack.error || 'Creation impossible.');
      return;
    }

    setRoleInfo(null);
    setStatus(`Room ${ack.roomCode} crée.`);

    if (pendingUploadFile) {
      await uploadAvatarNow(pendingUploadFile);
    }
  }

  async function joinRoom() {
    const name = validateName();
    if (!name) return;

    const roomCode = joinCode.trim();
    if (!/^\d{4}$/.test(roomCode)) {
      setStatus('Code room: exactement 4 chiffres.');
      return;
    }

    const ack = await emitAck('room:join', { name, roomCode, avatarUrl: selectedDefaultAvatar });
    if (!ack.ok) {
      setStatus(ack.error || 'Impossible de rejoindre.');
      return;
    }

    setRoleInfo(null);
    setStatus(`Tu as rejoint ${roomCode}.`);

    if (pendingUploadFile) {
      await uploadAvatarNow(pendingUploadFile);
    }
  }

  async function startGame() {
    const ack = await emitAck('game:start');
    if (!ack.ok) {
      setStatus(ack.error || 'Impossible de lancer.');
      return;
    }
    setStatus('Partie lancee.');
  }

  async function submitClue(event: FormEvent) {
    event.preventDefault();
    const text = clueText.trim();
    if (!text) return;

    const ack = await emitAck('game:clue', { text });
    if (!ack.ok) {
      setStatus(ack.error || 'Indice refuse.');
      return;
    }

    setClueText('');
    playSubmitSfx();
  }

  async function vote(targetId: string) {
    if (targetId === selfId) {
      setStatus('Tu ne peux pas voter pour toi.');
      return;
    }
    const ack = await emitAck('game:vote', { targetId });
    if (!ack.ok) {
      setStatus(ack.error || 'Vote refuse.');
      return;
    }
    setStatus('Vote enregistre.');
  }

  async function forceVoting() {
    const ack = await emitAck('game:forceVoting');
    if (!ack.ok) {
      setStatus(ack.error || 'Impossible de passer au vote.');
      return;
    }
    setStatus('Vote force par l hote.');
  }

  async function nextManche() {
    const ack = await emitAck('game:nextManche');
    if (!ack.ok) {
      setStatus(ack.error || 'Impossible de lancer la manche suivante.');
      return;
    }
    setClueText('');
    setStatus('Manche suivante lancee.');
  }

  async function applyLobbySettings() {
    if (!room || !room.isHost) return;
    const nextMatchCount = Math.max(1, Math.min(12, lobbyMatchCount));
    const nextRounds = Math.max(1, Math.min(8, lobbyWordRounds));

    const [matchAck, roundsAck] = await Promise.all([
      emitAck('room:updateMatchCount', { matchCount: nextMatchCount }),
      emitAck('room:updateWordRounds', { wordRounds: nextRounds })
    ]);

    if (!matchAck.ok) {
      setStatus(matchAck.error || 'Impossible de modifier les manches.');
      return;
    }
    if (!roundsAck.ok) {
      setStatus(roundsAck.error || 'Impossible de modifier les tours de mots.');
      return;
    }

    setStatus(`Reglages appliques: ${nextMatchCount} manches, ${nextRounds} tours.`);
  }

  async function adjustLobbyMatchCount(delta: number) {
    if (!room || !room.isHost || room.phase !== 'lobby') return;
    const nextMatchCount = Math.max(1, Math.min(12, lobbyMatchCount + delta));
    if (nextMatchCount === lobbyMatchCount) return;

    setLobbyMatchCount(nextMatchCount);
    const ack = await emitAck('room:updateMatchCount', { matchCount: nextMatchCount });
    if (!ack.ok) {
      setStatus(ack.error || 'Impossible de modifier les manches.');
      setLobbyMatchCount(room.totalManches);
      return;
    }
    setStatus(`Manches mises a jour: ${nextMatchCount}.`);
  }

  async function adjustLobbyWordRounds(delta: number) {
    if (!room || !room.isHost || room.phase !== 'lobby') return;
    const nextRounds = Math.max(1, Math.min(8, lobbyWordRounds + delta));
    if (nextRounds === lobbyWordRounds) return;

    setLobbyWordRounds(nextRounds);
    const ack = await emitAck('room:updateWordRounds', { wordRounds: nextRounds });
    if (!ack.ok) {
      setStatus(ack.error || 'Impossible de modifier les tours de mots.');
      setLobbyWordRounds(room.wordRounds);
      return;
    }
    setStatus(`Tours de mots mis a jour: ${nextRounds}.`);
  }

  async function backToLobby() {
    const ack = await emitAck('game:backToLobby');
    if (!ack.ok) {
      setStatus(ack.error || 'Retour lobby impossible.');
      return;
    }
    setRoleInfo(null);
    setStatus('Retour au lobby.');
  }

  async function leaveCurrentRoom() {
    await emitAck('room:leave');
    setRoom(null);
    setRoleInfo(null);
    setClueText('');
    setStatus('Tu as quitte la room.');
  }

  async function deleteCurrentRoom() {
    const ack = await emitAck('room:delete');
    if (!ack.ok) {
      setStatus(ack.error || 'Suppression room impossible.');
      return;
    }
    setRoom(null);
    setRoleInfo(null);
    setClueText('');
    setStatus('Room supprimee.');
  }

  async function copyRoomCode() {
    if (!room?.roomCode) return;
    try {
      await navigator.clipboard.writeText(room.roomCode);
      setCopied(true);
      setStatus(`Code ${room.roomCode} copie.`);
    } catch (_error) {
      setStatus('Impossible de copier automatiquement.');
    }
  }

  async function randomizeDefaultAvatar() {
    if (pendingUploadPreview) {
      URL.revokeObjectURL(pendingUploadPreview);
      setPendingUploadPreview(null);
      setPendingUploadFile(null);
    }

    let next = randomDefaultAvatar();
    if (next === selectedDefaultAvatar && DEFAULT_AVATARS.length > 1) {
      next = DEFAULT_AVATARS[(DEFAULT_AVATARS.indexOf(next) + 1) % DEFAULT_AVATARS.length];
    }
    setSelectedDefaultAvatar(next);

    if (room) {
      const ack = await emitAck('avatar:randomize');
      if (!ack.ok) {
        setStatus(ack.error || 'Impossible de remettre un avatar aléatoire.');
        return;
      }
      setStatus('Avatar aléatoire appliqué.');
    }
  }

  function onAvatarFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setStatus('Choisis un fichier image.');
      return;
    }

    if (file.size > 3 * 1024 * 1024) {
      setStatus('Image trop lourde (max 3MB).');
      return;
    }

    if (pendingUploadPreview) URL.revokeObjectURL(pendingUploadPreview);

    const preview = URL.createObjectURL(file);
    setPendingUploadFile(file);
    setPendingUploadPreview(preview);
    setStatus(room ? 'Image prete, upload en cours...' : 'Image prete: upload a l entree dans la room.');

    if (room) {
      void uploadAvatarNow(file);
    }

    event.target.value = '';
  }

  const currentSpeakerName = room?.currentSpeakerId ? (playersById.get(room.currentSpeakerId)?.name ?? null) : null;
  const roomHostName = room?.players.find((player) => player.isHost)?.name ?? '...';
  const profilePreview = pendingUploadPreview || selfPlayer?.avatarUrl || selectedDefaultAvatar;
  const previousClue = room?.clues.length ? room.clues[room.clues.length - 1] : null;
  const clueTimeLeftMs =
    room?.phase === 'clues' && room.clueTurnEndsAt
      ? Math.max(0, room.clueTurnEndsAt - nowTick)
      : 0;
  const clueTimeLeft = Math.ceil(clueTimeLeftMs / 1000);
  const clueProgressPercent = Math.max(
    0,
    Math.min(100, (clueTimeLeftMs / (CLUE_TURN_SECONDS * 1000)) * 100)
  );
  const cluesByPlayer = new Map<string, Clue[]>();
  if (room && room.phase !== 'lobby') {
    room.players.forEach((player) => cluesByPlayer.set(player.id, []));
    room.clues.forEach((clue) => {
      const entries = cluesByPlayer.get(clue.playerId);
      if (entries) entries.push(clue);
    });
  }

  if (room && (room.phase === 'clues' || room.phase === 'voting' || room.phase === 'ended')) {
    return (
      <GameView
        room={room}
        roleInfo={roleInfo}
        currentSpeakerName={currentSpeakerName}
        previousClue={previousClue}
        clueText={clueText}
        setClueText={setClueText}
        onSubmitClue={submitClue}
        clueTimeLeft={clueTimeLeft}
        clueProgressPercent={clueProgressPercent}
        selfId={selfId}
        cluesByPlayer={cluesByPlayer}
        onVote={vote}
        onForceVoting={forceVoting}
        onNextManche={nextManche}
        onBackToLobby={backToLobby}
        audioEnabled={audioEnabled}
        onToggleAudio={toggleAudio}
        audioVolume={audioVolume}
        onChangeAudioVolume={changeAudioVolume}
      />
    );
  }

  return (
    <main className="simple-page">
      <section className="simple-shell">
        <header className="simple-header">
          <div className="title-group">
            <img className="title-logo" src={withBase('/logo_blanc.png')} alt="Logo Undercover" />
            <h1>UNDERCOVER</h1>
          </div>
          {room ? (
            <div className="header-actions">
              <div className="room-code-chip">Code: <strong>{room.roomCode}</strong></div>
              {room.isHost ? (
                <button className="danger" type="button" onClick={deleteCurrentRoom}>
                  <span className="btn-icon" aria-hidden="true"><Trash2 /></span>
                  <span>Supprimer la room</span>
                </button>
              ) : (
                <button type="button" onClick={leaveCurrentRoom}>
                  <span className="btn-icon" aria-hidden="true"><DoorOpen /></span>
                  <span>Quitter la room</span>
                </button>
              )}
            </div>
          ) : null}
        </header>

        {!room && (
          <HomeView
            profilePreview={profilePreview}
            playerName={playerName}
            joinCode={joinCode}
            onPlayerNameChange={setPlayerName}
            onJoinCodeChange={setJoinCode}
            onRandomAvatar={randomizeDefaultAvatar}
            onAvatarFileChange={onAvatarFileChange}
            onCreateRoom={createRoom}
            onJoinRoom={joinRoom}
          />
        )}

        {room && (
          <section className="simple-grid room-layout">
            <article className="box">
              <h2>Room de {roomHostName}</h2>
              <div className="meta-line">
                <span>Manche {room.currentManche}/{room.totalManches}</span>
                <span>Tours de mots {room.wordRounds}</span>
                <span>Joueurs {room.players.length}</span>
              </div>
              <div className="top-actions">
                <button className="copy-code-btn" type="button" onClick={copyRoomCode}>
                  <span className="btn-icon" aria-hidden="true"><Copy /></span>
                  <span>{copied ? 'Copie !' : 'Copier le code'}</span>
                </button>
                <button type="button" onClick={leaveCurrentRoom}>
                  <span className="btn-icon" aria-hidden="true"><DoorOpen /></span>
                  <span>Retour menu</span>
                </button>
              </div>

              {roleInfo && room.phase !== 'lobby' && (
                <div className="role-block civilian">
                  <p>Mot secret: <strong>{roleInfo.word}</strong></p>
                </div>
              )}

              {room.phase === 'lobby' && (
                <WaitingRoomView
                  room={room}
                  lobbyMatchCount={lobbyMatchCount}
                  lobbyWordRounds={lobbyWordRounds}
                  onAdjustMatchCount={adjustLobbyMatchCount}
                  onAdjustWordRounds={adjustLobbyWordRounds}
                  onApplySettings={applyLobbySettings}
                  onStartGame={startGame}
                />
              )}

            </article>

            <article className="box">
              <h2>Joueurs</h2>
              <div className="self-card">
                <img className="avatarMini" src={profilePreview} alt="Mon avatar" />
                <div>
                  <strong>Mon profil</strong>
                </div>
              </div>

              <div className="row-actions">
                <button className="secondary-btn" type="button" onClick={randomizeDefaultAvatar}>
                  <span className="btn-icon" aria-hidden="true"><Shuffle /></span>
                  <span>Aléatoire</span>
                </button>
                <label className="uploadBtn uploadBtnStrong">
                  <span className="btn-icon" aria-hidden="true"><Upload /></span>
                  Importer photo
                  <input type="file" accept="image/*" onChange={onAvatarFileChange} />
                </label>
              </div>

              {isUploadingAvatar && <p>Upload en cours...</p>}

              <div className="players-list">
                {room.players.map((player) => (
                  <div className={`playerRow ${player.id === selfId ? 'me' : ''}`} key={player.id}>
                    <img className="avatarMini" src={player.avatarUrl} alt={`Avatar ${player.name}`} />
                    <div>
                      <strong>{player.name}</strong>
                      <small>{player.isHost ? 'Host' : 'Player'}</small>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          </section>
        )}

        <footer className="statusBar">{status}</footer>
      </section>
    </main>
  );
}
