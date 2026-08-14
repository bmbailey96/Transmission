// Artists pulled from data/albumHistory.js (every ranked/favorite/watchlist
// entry across all years) plus the named taste anchors in data/tasteProfile.js
// that didn't already show up there. Anything by one of these artists skips
// the normal date-ordered throttle entirely and gets scored immediately,
// since there's no real question of whether it's worth knowing about.
//
// Add to this directly as new favorites come up, no need to touch the
// discovery pipeline code to do it.

const artists = [
  '22 Halo', 'Aaron West and The Roaring Twenties', 'Adrianne Lenker', 'Al Menne',
  'Alan Sparhawk & Trampled By Turtles', 'Aldous Harding', 'Alex G', 'Amen Dunes',
  'Angel Olsen', 'Arlo Parks', 'Attention Bird Utopia', 'Babehoven', 'Beach House',
  'Ben Howard', 'Ben Kweller', 'Beth Orton', 'Better Oblivion Community Center',
  'Big Thief', 'Black Country, New Road', 'Black Pumas', 'Blood Orange', 'Bon Iver',
  'Briston Maroney', 'Cameron Winter', 'caroline', 'Cass McCombs', 'Cassandra Jenkins',
  'Clairo', 'Cocteau Twins', 'Daniela Andrade', 'Daughter of Swords', 'Deerhunter',
  'Dijon', 'Djo', 'Duster', 'Eli Hirsch', 'Ethel Cain', 'feeble little horse',
  'Field Medic', 'Finn Wolfhard', 'Friendship', 'Friko', 'Fruit Bats', 'Future Islands',
  'Geese', 'Gia Margaret', 'Godspeed You! Black Emperor', 'Great Grandpa', 'Grouper',
  'Haley Blais', 'Haley Heynderickx', 'Hand Habits', 'Harrison Whitford', 'Haute & Freddy',
  'hey, nothing', 'Hotline TNT', 'Hurray for the Riff Raff', 'HYUKOH & Sunset Rollercoaster',
  'Indigo De Souza', 'Japanese Breakfast', 'jasmin.4.t', 'Jay Som', 'Julien Baker',
  'Julien Baker & Torres', 'Katy Pinke', 'Kellen Christopher Cragg', 'Kevin Morby',
  'King Hannah', 'Kurt Vile', 'Lana Del Rey', 'Leith Ross', 'Low', 'Lucy Dacus',
  'Magdalena Bay', 'Maggie Rogers', 'Mali Velasquez', 'Marissa Nadler', 'Mazzy Star',
  'Michael Kiwanuka', 'Mitski', 'Model/Actriz', 'Mogwai', 'Mount Eerie', 'Mt. Joy',
  'My New Band Believe', 'Nation of Language', 'Nilufer Yanya', 'Noah Kahan',
  'Oliver Hazard', 'Oso Oso', 'Parquet Courts', 'Peach Pit', 'Phoebe Bridgers', 'Pile', 'Pinegrove',
  'Rachel Chinouriri', 'Racing Mount Pleasant', 'Remi Wolf', 'Rosie Tucker',
  'S. Carey & John Raymond', 'Samia', 'Saya Gray', 'Sharon Van Etten',
  'Sharon Van Etten & The Attachment Theory', 'Sharp Pins', 'Skullcrusher', 'Slowdive',
  'Snail Mail', 'Soccer Mommy', 'Squid', 'Sufjan Stevens', 'Suki Waterhouse', 'Tapir!',
  'Teethe', 'Temples', 'The Beths', 'The Last Dinner Party', 'The Microphones',
  'The National', 'The War on Drugs', 'The Weather Station', 'They Are Gutting a Body of Water',
  'This Is Lorelei', 'Tomberlin', 'Vampire Weekend', 'Visible Cloaks', 'Water From Your Eyes',
  'Waxahatchee', 'Wednesday', 'Wendy Eisenberg', 'Wet Leg', 'Widowspeak', 'Wolf Alice',
  'Yebba', 'boygenius', 'underscores',
  // added directly from pre-saved Spotify screenshots, not yet in any ranked year
  'Julia Jacklin', 'Slow Pulp', 'Man/Woman/Chainsaw', 'Swampmeet', 'mary in the junkyard',
];

// No labels seeded yet. Add specific labels here if there are ones you want
// watched regardless of artist, e.g. '4AD', 'Saddle Creek'.
const labels = [];

module.exports = { artists, labels };