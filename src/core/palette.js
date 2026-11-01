// Palette de couleurs partagée par tout ce qui est dessiné en canvas (plate.js, overlay.js,
// puppet.js, tutorial.js). Les mêmes valeurs existent en CSS dans src/theme.css pour le HTML :
// si tu changes une couleur ici, change aussi la variable correspondante dans theme.css.

export const BG = '#0b0720';
export const INK = '#f3f1fb';
export const INK_RGB = '243, 241, 251';
export const DIM = 'rgba(243, 241, 251, 0.72)';
export const FAINT = 'rgba(243, 241, 251, 0.14)';

export const ACCENT = '#ffcf5c'; // actions générales (pastilles, barres de progression, halo de pincement)
export const ACCENT_RGB = '255, 207, 92';
export const ACCENT_2 = '#ff6fae'; // deuxième teinte des dégradés (bouton Jouer, fond animé)
export const DANGER = '#ff4d5e';

// Mains : gauche violet clair, droite cyan.
export const LEFT = '#c9b6ff';
export const LEFT_RGB = '201, 182, 255';
export const RIGHT = '#5eead4';
export const RIGHT_RGB = '94, 234, 212';

// Une couleur par mode de la main droite (Geste Live) / mode du Studio.
export const MODE_COLORS = {
  drums: '#ff8a3d',
  bass: '#4da3ff',
  melody: '#ff6fae',
  fx: '#34e37a',
  sculpt: '#a78bfa',
};

// Une couleur par degré d'accord (I à VII), dans l'ordre.
export const CHORD_COLORS = ['#ff6b6b', '#ff9f45', '#ffd166', '#8ee36b', '#4dd0c4', '#5b9dff', '#b07bff'];

// Taches de couleur du fond animé (dérive lente derrière le jeu).
export const BLOB_COLORS = ['#5b2a86', '#1f4e8c', '#8c2d63'];

export const SANS = 'Geist, "Helvetica Neue", Arial, system-ui, sans-serif';
