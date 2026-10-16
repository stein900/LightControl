# LightControl

Application Windows qui pilote tout l’éclairage RGB d’un PC depuis une seule interface : carte mère et ses headers ARGB (AIO, ventilateurs, bandeaux), mémoire, périphériques et câbles Lian Li sans fil. Un seul effet peut être synchronisé sur tout le PC, ou un effet différent réglé zone par zone.

Construite avec Electron, TypeScript et React. Aucun service ni pilote supplémentaire n’est installé.

> Projet indépendant, sans lien avec MSI, Corsair, Lian Li, Logitech ou OpenRGB. Les noms de produits appartiennent à leurs propriétaires.

## Matériel pris en charge

LightControl combine trois canaux matériels derrière une même interface :

| Canal | Matériel | Fonctionnement |
| --- | --- | --- |
| [OpenRGB](https://openrgb.org) 1.0 | Cartes mères (headers RGB 12 V et ARGB 5 V), claviers, souris et la plupart des périphériques | Moteur embarqué, lancé en arrière-plan et limité à `127.0.0.1`. LightControl lui parle via son protocole SDK (version 5), avec un client écrit de zéro. |
| SDK Corsair iCUE | Appareils déjà gérés par iCUE (mémoire Vengeance RGB…) | Runtime officiel, chargé dans un processus isolé. Il demande le contrôle exclusif de l’éclairage tant que LightControl est ouvert. |
| Lian Li 2,4 GHz | Strimer Plus Wireless, UNI FAN Wireless, HydroShift II… | Protocole sans fil réimplémenté, accès au dongle USB via libusb dans un processus isolé. |

Matériel validé sur une vraie machine : carte MSI X670E (Mystic Light USB), AIO et ventilateurs Corsair sur headers ARGB, mémoire Corsair Vengeance RGB DDR5, Logitech G502 et G515, Lian Li Strimer Plus Wireless (24 broches et GPU).

## Fonctionnalités

- **Synchronisation globale** : un effet unique pour tout le PC, en phase, avec interrupteur et luminosité générale.
- **Effets par zone** : statique, dégradé, respiration, spectre, arc-en-ciel, vague, comète, scintillement, stroboscope. LightControl les calcule et les diffuse à 30 images/s. Sur les claviers, ils suivent la disposition physique des touches.
- **Modes matériels** : les effets intégrés à chaque appareil (vitesse, luminosité, direction, couleurs). Ils peuvent être enregistrés dans l’appareil pour rester actifs sans LightControl.
- **Headers ARGB** : nombre de LED réglable header par header. Pendant le réglage, la dernière LED s’allume en rouge pour aider à compter.
- **Balance des blancs** par appareil, avec test en direct. Elle corrige le blanc jaunâtre des longues chaînes ARGB.
- **Appareils sans fil Lian Li** : chaque effet est pré-calculé sur une boucle complète et compressé pour tenir dans la mémoire de l’appareil. L’appareil confirme l’animation reçue, puis la rejoue seul, même LightControl fermé.
- **Profils** applicables depuis l’application ou la zone de notification.
- **Diagnostic** : état des moteurs et intégrations, logiciels concurrents actifs (MSI Mystic Light, G HUB, L-Connect…), matériel détecté mais non pilotable.

## Installation

Windows 10 ou 11, 64 bits. Lancer `LightControl-Setup-<version>.exe` (installation par utilisateur, sans droits administrateur).

Selon le matériel :

- **MSI** : dans MSI Center › Fonctionnalités, désinstaller Mystic Light. Sinon, il réapplique ses couleurs au démarrage et en sortie de veille.
- **Corsair** : laisser iCUE ouvert et activer son SDK dans ses réglages.
- **Lian Li sans fil** : L-Connect 3 garde le dongle pour lui. Dans Diagnostic › Intégrations, « Prendre le contrôle » arrête ses services et les passe en démarrage manuel. « Rendre la main » les rétablit à l’identique. Chaque opération demande une confirmation administrateur ; rien n’est désinstallé et le firmware n’est jamais modifié. Pour appairer un nouvel appareil Lian Li : rendre la main, l’appairer dans L-Connect, puis reprendre le contrôle.

## Développement

Prérequis : Node.js 22 ou plus récent, Windows.

| Commande | Rôle |
| --- | --- |
| `npm install` | Installe les dépendances et télécharge OpenRGB et le runtime iCUE dans `vendor/` |
| `npm run dev` | Lance l’application en développement, avec rechargement à chaud de l’interface |
| `npm run dist` | Produit l’installateur `release/<version>/LightControl-Setup-<version>.exe` |
| `npm run test` | Tests unitaires : protocoles OpenRGB et Lian Li, compression, effets, planificateur, moteur |
| `npm run typecheck` / `npm run lint` | Vérification des types et ESLint |

Tests optionnels sur matériel réel, désactivés par défaut :

```sh
OPENRGB_LIVE=127.0.0.1:6742 npx vitest run client.live        # serveur OpenRGB en marche, lecture seule
LIANLI_LIVE=1 npx vitest run wireless.live                     # appareils Lian Li appairés, lecture seule
LIANLI_UPLOAD=255,0,0 npx vitest run wireless-upload.live      # couleur fixe envoyée aux appareils Lian Li
```

Les tests Lian Li ont besoin du dongle libre : LightControl et L-Connect doivent être fermés.

## Architecture

```
src/
  shared/              Contrat commun : schémas Zod, modèle du domaine, effets, canaux IPC
  main/                Processus principal, sans dépendance à l'interface
    app/               Racine de composition et façade de l'application
    hardware/          Port HardwareBackend, hub qui combine les backends
      openrgb/         Client du protocole SDK, codec binaire, supervision du processus
      icue/            Hôte isolé (utilityProcess + koffi) et backend avec chien de garde
      lianli/          Protocole RF, compression tinyuz, liaison libusb, hôte isolé
    lighting/          Rendu des effets, couleurs, planificateur (fonction pure), moteur
    services/          État d'éclairage, réglages, profils, diagnostic
    system/            Requêtes Windows, passage de main avec L-Connect 3
    ipc/, security/, windows/
  preload/             Pont contextBridge minimal
  renderer/src/        Interface React : composants, pages, état (zustand)
```

Le moteur d’éclairage ne connaît que le port `HardwareBackend`. Pour ajouter une technologie matérielle, il suffit de l’implémenter : moteur, services et interface restent inchangés. Les appareils qui ne reçoivent pas d’images en continu (le sans-fil) se déclarent en livraison « boucle ». Le moteur leur envoie alors une animation complète à chaque changement.

## Sécurité

- **Interface** : fenêtre en bac à sable, isolation de contexte, aucune API Node dans l’interface. CSP stricte ; navigation, nouvelles fenêtres et permissions bloquées.
- **IPC** : chaque canal vérifie l’expéditeur et valide sa charge avec Zod. Les erreurs internes ne sont jamais renvoyées telles quelles.
- **Exécutable** : interface servie par un protocole `app://` privilégié. Fusibles Electron : pas de `RunAsNode`, intégrité de l’archive ASAR, `file://` sans privilèges.
- **Code natif isolé** : les bibliothèques natives (iCUE, libusb) tournent dans des processus utilitaires séparés. Un plantage ou un blocage n’y atteint pas l’application.
- **Réseau et droits** : serveur OpenRGB lié à `127.0.0.1`, liens externes limités à une liste de domaines. Les seules opérations privilégiées sont des scripts fixes, lancés après confirmation Windows.

## Crédits et licences tierces

- **OpenRGB** (GPL-2.0) : programme séparé, livré tel quel et piloté uniquement par son protocole réseau.
- **libusb** (LGPL-2.1) : bibliothèque livrée avec OpenRGB.
- **Corsair iCUE SDK** : le runtime redistribuable officiel.
- **[lian-li-linux](https://github.com/sgtaziz/lian-li-linux)** (MIT) : le protocole Lian Li est réimplémenté d’après ce projet.
- **[tinyuz](https://github.com/sisong/tinyuz)** (MIT) : le format de compression vient de ce projet.

Textes et détails : [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
