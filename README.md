# Ward

Widget de bureau pour lancer une partie League of Legends sans ouvrir le client.

Files : Solo/Duo, Flex, Normale, ARAM, ARAM Mayhem et l'Arena du moment (avec changement d'équipe). Les règles de chaque file (taille de groupe, rôles, niveau requis, motifs de blocage) sont lues dans le client via `/lol-game-queues/v1/queues` et le lobby (voir `electron/queues.cjs`) ; le widget s'agrandit selon la file (300 × 230 en Solo/Duo, 440 px de large en groupe ou en Arena). Swiftplay et Clash ne sont pas proposés : ils se préparent dans le client.

Sélection des champions dans le widget (`electron/champselect.cjs`, `renderer/champselect.js`) : le widget passe en 520 × 460, affiche alliés, ennemis, bannissements et chrono, permet de survoler, verrouiller ou bannir, de changer de sorts, de gérer l'ARAM (relance, banc) et les demandes d'échange. Runes (`electron/runes.cjs`, `renderer/runes.js`) : choix de page, runes recommandées par le client (sorts compris, Flash gardé sur sa touche) et éditeur complet ; une page n'est modifiée que si elle est modifiable, sinon une nouvelle page est créée s'il reste de la place. Le client League ne s'ouvre plus automatiquement à la sélection (bouton ↗ pour l'afficher).

Petit widget Windows de 240 × 180 px (252 × 192 avec les marges transparentes), sans barre de titre. Les autres fenêtres peuvent le recouvrir. Déplace-le en tirant la zone « SOLO / DUO ».

- démarre automatiquement League par le Riot Client s'il n'est pas déjà ouvert, puis ferme la fenêtre du client (voir « Vanguard » plus bas) ; `npm run dev` affiche les étapes horodatées (`[Ward] demarrage - …`) ;
- affiche la photo de profil du joueur connecté ;
- le bouton ↗ en haut à droite affiche le client League normal à tout moment une fois connecté, sans fermer la session headless, annuler la recherche ni recréer le lobby ;
- ouvre les amis connectés et la saisie `Pseudo#TAG` avec le bouton « + » ;
- crée le lobby Solo/Duo classé (420) à la première invitation ou au clic sur « Lancer » ;
- « Lancer » démarre la recherche, puis devient « Annuler » ;
- un second clic sur ce même bouton annule la recherche ;
- les deux petites icônes sous la photo permettent de choisir le rôle principal et secondaire (ou Remplissage), par clic direct sur l'icône voulue ; les choix sont mémorisés et confirmés par le LCU avant la recherche ;
- affiche le temps écoulé en recherche et l’attente estimée donnée par League ;
- ouvre un popup d’acceptation avec un compte à rebours circulaire, puis « En attente des joueurs » ;
- ouvre automatiquement l’interface du client au passage en sélection des champions ; le bouton « Choisir mon champion » permet aussi de la rappeler.

## Installation

```powershell
npm install
npm start
```

L'installation est détectée dans les métadonnées Riot, y compris sur un autre disque. `LOL_CLIENT_PATH` permet de préciser un chemin si nécessaire. Le démarrage utilise la session Riot locale pour lancer `LeagueClient.exe --headless` sans reboucler sur le launcher. Si Riot demande une connexion ou une mise à jour, termine-la dans Riot Client puis clique sur « Réessayer ».

Le LCU est découvert via son lockfile, même sans processus `LeagueClientUx.exe`. Les identifiants locaux restent en mémoire et ne sont jamais envoyés au renderer. L'exception de certificat HTTPS est limitée aux requêtes vers `127.0.0.1`.

## Exécutable Windows portable

`npm run build:exe` génère `out/Ward-0.1.4-portable.exe` pour Windows x64. Ce fichier est autonome : Node.js et les sources ne sont pas nécessaires sur le PC cible, mais League et Riot Client doivent y être installés. Double-clique dessus pour démarrer le widget. Aucun droit administrateur ni installation n’est demandé. Les préférences restent dans `%APPDATA%/ward`, comme en développement. Les rôles enregistrés sous l’ancien nom (`%APPDATA%/lol-ranked-widget`) sont repris automatiquement au premier lancement.

L’emblème vert et or est une création vectorielle locale (`renderer/assets/app-icon.svg`). `npm run build:icon` en dérive automatiquement l’icône Windows en sept tailles, de 16 à 256 px, et l’icône de fenêtre. Cette génération est incluse dans `build:exe`.

Le binaire n’est pas signé avec un certificat éditeur ; Windows peut donc afficher un avertissement de réputation. Le dossier `out/win-unpacked` est un résultat intermédiaire : ne déplace pas son `.exe` seul. C’est le fichier **portable** à la racine de `out` qu’il faut utiliser ou copier.

`npm run test:exe` vérifie l’exécutable compilé en mode aperçu, sans lancer League ni envoyer de requête LCU. La compilation exclut les tests, captures et données utilisateur.

Cette compilation conserve Electron 37.10.3. L’audit npm signale deux dépendances avec des alertes élevées (`electron` et `extract-zip`) : la création du portable ne les corrige pas. Prévoir une mise à jour du moteur et une nouvelle validation avant une diffusion publique.

## Fonctionnement

En session headless, `ux-show` seul peut réussir sans démarrer l’interface. Le bouton vérifie donc le processus UX de la session, appelle `launch-ux` s’il est absent, puis `ux-show` et attend une fenêtre Windows visible et non minimisée. Il confirme « Client League affiché » uniquement après cette vérification. Sinon, il renvoie une erreur après environ 30 secondes ; aucun processus n’est tué et aucun lobby n’est recréé. L’inspection Windows ne renvoie ni ligne de commande ni identifiants.

Le widget ne sélectionne pas de champion et ne joue pas à votre place. Après acceptation, il attend les autres joueurs puis demande au LCU de lancer/afficher l’interface de la session League existante pour la sélection des champions. Il ne relance pas une seconde session. En cas d’échec, il réessaie au maximum trois fois, puis laisse le bouton de rappel disponible. Le client reste ensuite ouvert. « Partie en cours » est réservé à la phase `InProgress` ; sélection, chargement et fin de partie ont leurs propres libellés.

Le LCU fournit le temps **écoulé** du ready-check, sans durée totale. Le compte à rebours visuel est estimé à partir de l’animation du client 16.18 (`timer-countdown.webm`, 10,733 secondes) et se recale sur les échantillons du LCU. L’état serveur reste prioritaire : le widget ne refuse pas un clic simplement parce que l’estimation atteint zéro. Le chrono de recherche est distinct et ne constitue pas une promesse de temps d’attente.

Les restrictions de classement, de groupe et les préférences de positions de League continuent de s'appliquer. Un lobby existant d'une autre file n'est pas remplacé automatiquement.

Si le serveur refuse les rôles avec `INVALID_REQUEST` car un ancien lobby reste verrouillé, le widget peut recréer ce lobby uniquement si tu es seul, chef de groupe, sans invitation en attente, sans recherche et sans ready-check. Les lobbies avec des amis sont préservés et un message indique comment réessayer.

Les icônes de rôles sont celles du client League, distribuées par [CommunityDragon](https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-parties/global/default/), et sont incluses localement.

## Vérification

`npm run check` vérifie la syntaxe. `npm test` vérifie les timers, l’ouverture du client, la récupération des lobbies verrouillés et la préservation des groupes et invitations. `npm run test:ui` vérifie le rendu et les interactions avec des réponses simulées : recherche/annulation, compte à rebours, erreur d’acceptation et nouvelle tentative, attente des autres joueurs, ouverture automatique/manuelle de la sélection et libellés des phases. Il ne lance aucune invitation ni recherche réelle ; les captures sont dans `.qa/`. `node scripts/check-client.cjs` vérifie la connexion locale en lecture seule ; ajouter `--launch` teste aussi le démarrage headless.

## Mise à jour automatique

Au lancement, l'exe portable interroge `https://api.github.com/repos/gaut123456/ward/releases/latest` (voir `electron/updater.cjs`). Si la release est plus récente que `package.json`, Ward télécharge son fichier `Ward-portable.exe` à côté de l'exe actuel, vérifie la taille et l'empreinte SHA-256 fournies par GitHub, attend un moment calme (ni recherche ni partie), puis se ferme : un script PowerShell remplace l'exe et relance Ward. Le journal est dans `%TEMP%\ward-update.log`. Rien ne se passe avec `npm start` (application non packagée).

Pour publier une version :

1. augmenter `version` dans `package.json` ;
2. `npm run build:exe` ;
3. créer une release GitHub `vX.Y.Z` contenant **`Ward-portable.exe`** (copie de `out/Ward-X.Y.Z-portable.exe`) ; sans ce fichier, les widgets installés ne se mettent pas à jour :

```sh
cp out/Ward-X.Y.Z-portable.exe out/Ward-portable.exe
gh release create vX.Y.Z out/Ward-X.Y.Z-portable.exe out/Ward-portable.exe --title "Ward X.Y.Z"
```

## Tester avec le vrai client (`scripts/lobby-lab.cjs`)

Banc d'essai pour les tests en conditions réelles. Il refuse d'agir pendant une recherche, une partie ou si d'autres joueurs sont dans le lobby, et ne verrouille jamais de champion.

```sh
node scripts/lobby-lab.cjs state              # état actuel (lecture seule)
node scripts/lobby-lab.cjs queues             # files et parties perso disponibles
node scripts/lobby-lab.cjs lobby 1740         # lobby d'une file (ici l'Arena du moment)
node scripts/lobby-lab.cjs champ-select       # Outil d'entraînement (3140) jusqu'à la sélection des champions
node scripts/lobby-lab.cjs cleanup            # annule la sélection perso et supprime le lobby
```

À savoir (client de septembre 2026) :

- partie perso : `POST /lol-lobby/v2/lobby { queueId, isCustom: true, customGameLobby: { lobbyName, configuration: {} } }` ; il faut **les deux** (sans `queueId` : `500 INVALID_LOBBY`, sans `customGameLobby` : `400 INVALID_REQUEST`) ;
- après une sélection perso annulée, `start-champ-select` répond `{ success: false }` pendant environ 15 s ;
- après une sélection perso annulée puis le lobby supprimé, le client reste « en recherche » sans lobby : `DELETE /lol-matchmaking/v1/search` l'efface (fait par `cleanup`) ;
- un démarrage peut passer directement en jeu : il faut alors fermer le jeu d'entraînement ; si le client redémarre pendant la partie, il s'y reconnecte tout seul ;
- en sélection des champions : `PATCH /lol-champ-select/v1/session/actions/{id} { championId }` survole sans verrouiller, `PATCH …/session/my-selection { spell1Id, spell2Id }` change les sorts ;
- un Ward lancé en parallèle (`npm start`) ouvre le client à l'écran dès la sélection des champions, comme en partie normale.

## Vanguard

Ward ne touche jamais à Vanguard. League est toujours lancé **par le Riot Client** (`POST /product-launcher/v1/products/league_of_legends/patchlines/live`, secours `--launch-product=league_of_legends --launch-patchline=live`), le chemin prévu par Riot, qui gère Vanguard. Si Ward a lancé League, il ferme l'interface du client par la commande officielle (`POST /riotclient/kill-ux`) quand elle s'ouvre sans avoir été demandée, puis retire le splash (logo League) que `LeagueClient.exe` laisse affiché (`DELETE /riotclient/splash`) ; le bouton ↗ suspend cette fermeture jusqu'à ce que le client soit refermé.

À ne jamais faire (essayé pendant le développement, a déclenché VAN 2266 puis « Vanguard Security Violation 290 ») : lancer `LeagueClient.exe` directement (`--headless`), démarrer ou arrêter soi-même les services `vgk`/`vgc`, fermer de force `League of Legends.exe`.
