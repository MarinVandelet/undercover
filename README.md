# Undercover (Vite + React + Socket.IO)

Jeu multijoueur Undercover avec rooms privees:
- Choix du pseudo
- Creation de room
- Rejoindre une room via code 4 chiffres
- 1 Undercover (mot different)
- 3 tours d'indices
- Vote final
- Avatar aleatoire selectable des l'accueil
- Upload avatar depuis PC (stocke sur le serveur)
- Suppression auto des avatars importes apres 2h, puis retour avatar aleatoire

## Securite du mot
La liste de mots et l'attribution des roles sont uniquement sur le serveur (`server/`).
Le front React ne contient pas les paires de mots.

## Lancer en local
1. `npm install`
2. `npm --prefix client install`
3. `npm run dev`

- Front Vite: `http://localhost:5173`
- Serveur Socket/API: `http://localhost:3001`

## Build production
1. `npm run build`
2. `npm start`

Le serveur Express sert automatiquement `client/dist` en production.

## Deploiement VPS
- Ouvrir le port app (ou passer via Nginx reverse proxy)
- Definir `PORT` si besoin
- Definir `CLIENT_ORIGIN` (ex: `https://ton-domaine.com`)

Exemple:
- `PORT=3001 CLIENT_ORIGIN=https://ton-domaine.com npm start`
