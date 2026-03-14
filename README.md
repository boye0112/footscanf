# ⚽ FOOTSCANF

## Prérequis

Avant tout, installe **Node.js** sur ta machine :
- Va sur **https://nodejs.org**
- Télécharge la version **LTS** (bouton vert à gauche)
- Lance l'installeur et suis les étapes
- **Redémarre ton PC** après l'installation

## Installation

Ouvre un terminal (cmd sur Windows, Terminal sur Mac) dans le dossier footscanf :

**Windows (cmd) :**
```
cd C:\Users\TonNom\Downloads\footscanf
npm install
npm start
```

**Mac / Linux :**
```
cd ~/Downloads/footscanf
npm install
npm start
```

Puis ouvre **http://localhost:3000** dans ton navigateur.

La prédiction est faite par un algorithme basé sur :
- Classement & points
- Bilan V/N/D
- Buts marqués / encaissés
- Forme des 5 derniers matchs
- Cotes bookmakers (si tu les saisis)

## Saisir les cotes

Sur le site, clique sur un match puis entre les cotes
depuis Betclic, Unibet, Winamax ou bet365.
Ça affine automatiquement la prédiction.