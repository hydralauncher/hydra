export type DecorationCategory =
  | "seasonal"
  | "gaming"
  | "anime"
  | "characters"
  | "fantasy"
  | "scifi"
  | "animals"
  | "nature"
  | "food"
  | "aesthetic"
  | "effects"
  | "quests"
  | "orbs"
  | "borderlands"
  | "lunar_eclipse"
  | "rawr_xd"
  | "dragon_ball"
  | "spirit_blossom"
  | "zen_protocol"
  | "my_hero_academia"
  | "star_wars"
  | "jennie"
  | "steampunk"
  | "lofi_girl"
  | "arcane"
  | "dojo"
  | "dark_fantasy"
  | "arcade"
  | "galaxy";

export interface AvatarDecoration {
  id: string;
  label: string;
  category: DecorationCategory;
}

export const CATEGORY_LABELS: Record<DecorationCategory, string> = {
  seasonal: "Temporada & Feriados",
  gaming: "Gaming",
  anime: "Anime & TV",
  characters: "Personagens & Mascotes",
  fantasy: "Fantasia & Magia",
  scifi: "Sci-Fi & Tech",
  animals: "Animais & Criaturas",
  nature: "Natureza & Flores",
  food: "Comida & Bebida",
  aesthetic: "Aesthetic & Vibe",
  effects: "Efeitos",
  quests: "Quests",
  orbs: "Orbs Exclusive",
  borderlands: "Borderlands 4",
  lunar_eclipse: "Lunar Eclipse",
  rawr_xd: "Rawr xD",
  dragon_ball: "Dragon Ball",
  spirit_blossom: "Spirit Blossom Beyond",
  zen_protocol: "Zen Protocol",
  my_hero_academia: "My Hero Academia",
  star_wars: "Star Wars",
  jennie: "JENNIE",
  steampunk: "Steampunk",
  lofi_girl: "Lofi Girl",
  arcane: "Arcane",
  dojo: "Dojo",
  dark_fantasy: "Dark Fantasy",
  arcade: "Arcade",
  galaxy: "Galaxy",
};

export const DECORATION_CATEGORIES = Object.keys(
  CATEGORY_LABELS
) as DecorationCategory[];

export const AVATAR_DECORATIONS: AvatarDecoration[] = [
  // ── Seasonal & Holidays ──────────────────────────────────────────────────
  { id: "snowglobe", label: "Snowglobe", category: "seasonal" },
  { id: "snowglobe_wood", label: "Snowglobe (Wood)", category: "seasonal" },
  { id: "snowglobe_pink", label: "Snowglobe (Pink)", category: "seasonal" },
  { id: "snowglobe_blue", label: "Snowglobe (Blue)", category: "seasonal" },
  { id: "snowglobe_green", label: "Snowglobe (Green)", category: "seasonal" },
  { id: "fresh_pine", label: "Fresh Pine", category: "seasonal" },
  {
    id: "fresh_pine_cinnamon",
    label: "Fresh Pine (Cinnamon)",
    category: "seasonal",
  },
  {
    id: "fresh_pine_ribbon",
    label: "Fresh Pine (Ribbon)",
    category: "seasonal",
  },
  { id: "spooky_cat_ears", label: "Spooky Cat Ears", category: "seasonal" },
  {
    id: "spooky_cat_ears_midnight",
    label: "Spooky Cat Ears (Midnight)",
    category: "seasonal",
  },
  { id: "candlelight", label: "Candlelight", category: "seasonal" },
  {
    id: "candlelight_crimson",
    label: "Candlelight (Crimson)",
    category: "seasonal",
  },
  { id: "candlelight_dark", label: "Candlelight (Dark)", category: "seasonal" },
  { id: "hood_dark", label: "Dark Hood", category: "seasonal" },
  { id: "hood_crimson", label: "Crimson Hood", category: "seasonal" },
  { id: "witch_hat_plum", label: "Witch Hat (Plum)", category: "seasonal" },
  {
    id: "witch_hat_midnight",
    label: "Witch Hat (Midnight)",
    category: "seasonal",
  },
  { id: "zombie_food", label: "Zombie Food", category: "seasonal" },
  {
    id: "zombie_food_purple",
    label: "Zombie Food (Purple)",
    category: "seasonal",
  },
  { id: "bloodthirsty", label: "Bloodthirsty", category: "seasonal" },
  {
    id: "bloodthirsty_green",
    label: "Bloodthirsty (Green)",
    category: "seasonal",
  },
  {
    id: "bloodthirsty_gold",
    label: "Bloodthirsty (Gold)",
    category: "seasonal",
  },
  { id: "new_year_2024", label: "New Year 2024", category: "seasonal" },
  { id: "graveyard_cat", label: "Graveyard Cat", category: "seasonal" },
  { id: "ghosts", label: "Ghosts", category: "seasonal" },
  { id: "minions", label: "Minions", category: "seasonal" },
  { id: "jack_o_lantern", label: "Jack-O'-Lantern", category: "seasonal" },
  { id: "pumpkin_spice", label: "Pumpkin Spice", category: "seasonal" },
  { id: "frog_hat", label: "Frog Hat", category: "seasonal" },
  { id: "aurora", label: "Aurora", category: "seasonal" },
  { id: "polar_bear_hat", label: "Polar Bear Hat", category: "seasonal" },
  { id: "string_lights", label: "String Lights", category: "seasonal" },
  {
    id: "string_lights_aurora",
    label: "String Lights (Aurora)",
    category: "seasonal",
  },
  {
    id: "string_lights_ember",
    label: "String Lights (Ember)",
    category: "seasonal",
  },
  {
    id: "string_lights_dusk",
    label: "String Lights (Dusk)",
    category: "seasonal",
  },
  {
    id: "string_lights_mix",
    label: "String Lights (Mix)",
    category: "seasonal",
  },
  {
    id: "chrysanthemums_twilight",
    label: "Chrysanthemums (Twilight)",
    category: "seasonal",
  },
  {
    id: "chrysanthemums_morning",
    label: "Chrysanthemums (Morning)",
    category: "seasonal",
  },
  { id: "dusk_and_dawn", label: "Dusk and Dawn", category: "seasonal" },
  { id: "floral_harmony", label: "Floral Harmony", category: "seasonal" },
  {
    id: "floral_harmony_sunburst",
    label: "Floral Harmony (Sunburst)",
    category: "seasonal",
  },
  { id: "autumns_arbor", label: "Autumn's Arbor", category: "seasonal" },
  {
    id: "autumns_arbor_aurora",
    label: "Autumn's Arbor (Aurora)",
    category: "seasonal",
  },
  { id: "autumn_crown", label: "Autumn Crown", category: "seasonal" },
  { id: "faces_of_the_moon", label: "Faces of the Moon", category: "seasonal" },
  { id: "fox_hat", label: "Fox Hat", category: "seasonal" },

  // ── Gaming ───────────────────────────────────────────────────────────────
  { id: "lego_fortnite", label: "LEGO Fortnite", category: "gaming" },
  {
    id: "fortnite_galactic_battle",
    label: "Galactic Battle",
    category: "gaming",
  },
  { id: "fortnite_boogie_bomb", label: "Boogie Bomb", category: "gaming" },
  {
    id: "street_fighter_6_battle_field",
    label: "SF6 Battle Field",
    category: "gaming",
  },
  { id: "victory_crown", label: "Victory Crown", category: "gaming" },
  { id: "marvel_snap_venom", label: "Venom", category: "gaming" },
  { id: "ryu", label: "Ryu", category: "gaming" },
  { id: "chun_li", label: "Chun-Li", category: "gaming" },
  { id: "ken", label: "Ken", category: "gaming" },
  { id: "akuma", label: "Akuma", category: "gaming" },
  { id: "cammy", label: "Cammy", category: "gaming" },
  { id: "guile", label: "Guile", category: "gaming" },
  { id: "juri", label: "Juri", category: "gaming" },
  { id: "m_bison", label: "M. Bison", category: "gaming" },
  {
    id: "valorant_champions_2024",
    label: "Valorant Champions 2024",
    category: "gaming",
  },
  {
    id: "yoru_dimensional_drift",
    label: "Yoru Dimensional Drift",
    category: "gaming",
  },
  { id: "viper_poison_cloud", label: "Viper Poison Cloud", category: "gaming" },
  {
    id: "cypher_neural_theft",
    label: "Cypher Neural Theft",
    category: "gaming",
  },
  { id: "omens_cowl", label: "Omen's Cowl", category: "gaming" },
  { id: "reynas_leer", label: "Reyna's Leer", category: "gaming" },
  { id: "frag_out", label: "Frag Out", category: "gaming" },
  { id: "blade_storm", label: "Blade Storm", category: "gaming" },
  { id: "chillet", label: "Chillet", category: "gaming" },
  { id: "pal_sphere", label: "Pal Sphere", category: "gaming" },
  { id: "cattiva", label: "Cattiva", category: "gaming" },
  { id: "lamball", label: "Lamball", category: "gaming" },
  { id: "depresso", label: "Depresso", category: "gaming" },

  // ── Anime & TV ───────────────────────────────────────────────────────────
  { id: "dragon_balls", label: "Dragon Balls", category: "anime" },
  { id: "cat_onesie", label: "Cat Onesie", category: "anime" },
  { id: "cat_onesie_pink", label: "Cat Onesie (Pink)", category: "anime" },
  { id: "cat_onesie_black", label: "Cat Onesie (Black)", category: "anime" },
  { id: "shy", label: "Shy", category: "anime" },
  { id: "rumbling", label: "Rumbling", category: "anime" },
  { id: "magical_girl", label: "Magical Girl", category: "anime" },
  { id: "sakura_scholar", label: "Sakura Scholar", category: "anime" },
  { id: "sushi_roll", label: "Sushi Roll", category: "anime" },
  { id: "ramen_bowl", label: "Ramen Bowl", category: "anime" },
  {
    id: "ramen_bowl_toppings",
    label: "Ramen Bowl Toppings",
    category: "anime",
  },
  { id: "spongebob", label: "SpongeBob", category: "anime" },
  { id: "imagination", label: "Imagination", category: "anime" },
  { id: "patrick_star", label: "Patrick Star", category: "anime" },
  { id: "flower_clouds", label: "Flower Clouds", category: "anime" },
  { id: "gary_the_snail", label: "Gary The Snail", category: "anime" },
  { id: "sandy_cheeks", label: "Sandy Cheeks", category: "anime" },
  { id: "musclebob", label: "MuscleBob", category: "anime" },

  // ── Characters & Mascotes ────────────────────────────────────────────────
  { id: "clyde_invaders", label: "Clyde Invaders", category: "characters" },
  { id: "chuck", label: "Chuck", category: "characters" },
  { id: "winkle", label: "Winkle", category: "characters" },
  { id: "chewbert", label: "Chewbert", category: "characters" },
  { id: "doodlezard", label: "Doodlezard", category: "characters" },
  { id: "glop", label: "Glop", category: "characters" },
  { id: "gawblehop", label: "Gawblehop", category: "characters" },

  // ── Fantasy & Magic ──────────────────────────────────────────────────────
  {
    id: "spirit_blossom_springs_sett",
    label: "Spirit Blossom (Sett)",
    category: "fantasy",
  },
  {
    id: "spirit_blossom_springs",
    label: "Spirit Blossom Springs",
    category: "fantasy",
  },
  {
    id: "spirit_blossom_springs_ahri",
    label: "Spirit Blossom (Ahri)",
    category: "fantasy",
  },
  { id: "white_mana", label: "White Mana", category: "fantasy" },
  { id: "blue_mana", label: "Blue Mana", category: "fantasy" },
  { id: "black_mana", label: "Black Mana", category: "fantasy" },
  { id: "red_mana", label: "Red Mana", category: "fantasy" },
  { id: "green_mana", label: "Green Mana", category: "fantasy" },
  { id: "dice_violet", label: "Dice (Violet)", category: "fantasy" },
  { id: "dice_azure", label: "Dice (Azure)", category: "fantasy" },
  {
    id: "gelatinous_cube_green",
    label: "Gelatinous Cube (Green)",
    category: "fantasy",
  },
  {
    id: "gelatinous_cube_blue",
    label: "Gelatinous Cube (Blue)",
    category: "fantasy",
  },
  { id: "owlbear_cub", label: "Owlbear Cub", category: "fantasy" },
  {
    id: "owlbear_cub_snowy",
    label: "Owlbear Cub (Snowy)",
    category: "fantasy",
  },
  {
    id: "baby_displacer_beast",
    label: "Baby Displacer Beast",
    category: "fantasy",
  },
  { id: "magic_mists", label: "Magic Mists", category: "fantasy" },
  {
    id: "spirit_blossom_zed",
    label: "Spirit Blossom (Zed)",
    category: "fantasy",
  },
  {
    id: "spirit_blossom_morgana",
    label: "Spirit Blossom (Morgana)",
    category: "fantasy",
  },
  {
    id: "spirit_blossom_karma",
    label: "Spirit Blossom (Karma)",
    category: "fantasy",
  },
  { id: "fairy_sprites", label: "Fairy Sprites", category: "fantasy" },
  { id: "magical_wand_purple", label: "Magical Wand", category: "fantasy" },

  // ── Aesthetic & Vibe ─────────────────────────────────────────────────────
  { id: "neon_cat_hoodie", label: "Neon Cat Hoodie", category: "aesthetic" },
  {
    id: "neon_cat_hoodie_blue",
    label: "Neon Cat Hoodie (Blue)",
    category: "aesthetic",
  },
  {
    id: "neon_cat_hoodie_pink",
    label: "Neon Cat Hoodie (Pink)",
    category: "aesthetic",
  },
  {
    id: "neon_cat_hoodie_black",
    label: "Neon Cat Hoodie (Black)",
    category: "aesthetic",
  },
  { id: "heartbloom", label: "Heartbloom", category: "aesthetic" },
  {
    id: "rose_bearer_pink",
    label: "Rose Bearer (Pink)",
    category: "aesthetic",
  },
  { id: "angel", label: "Angel", category: "aesthetic" },
  { id: "devil", label: "Devil", category: "aesthetic" },
  { id: "lovestruck", label: "Lovestruck", category: "aesthetic" },
  { id: "ruby_hearts", label: "Ruby Hearts", category: "aesthetic" },
  { id: "snakes_hug", label: "Snake's Hug", category: "aesthetic" },
  { id: "lotus_flower", label: "Lotus Flower", category: "aesthetic" },
  { id: "red_lantern", label: "Red Lantern", category: "aesthetic" },
  { id: "mirage", label: "Mirage", category: "aesthetic" },
  { id: "mirage_void", label: "Mirage (Void)", category: "aesthetic" },
  { id: "mirage_twilight", label: "Mirage (Twilight)", category: "aesthetic" },
  {
    id: "mirage_nightshade",
    label: "Mirage (Nightshade)",
    category: "aesthetic",
  },

  // ── Scifi & Tech ──────────────────────────────────────────────
  { id: "beamchop", label: "Beamchop", category: "scifi" },
  { id: "hologram_dragon", label: "Hologram Dragon", category: "scifi" },
  { id: "cyber_katana", label: "Cyber Katana", category: "scifi" },

  // ── Effects ──────────────────────────────────────────────────────────────
  { id: "fire", label: "Fire", category: "effects" },
  { id: "water", label: "Water", category: "effects" },
  { id: "air", label: "Air", category: "effects" },
  { id: "earth", label: "Earth", category: "effects" },
  { id: "lightning", label: "Lightning", category: "effects" },
  { id: "balance", label: "Balance", category: "effects" },
  { id: "smoke", label: "Smoke", category: "effects" },
  { id: "chromawave", label: "Chromawave", category: "effects" },
  // ── HALLOWEEN '25 ──────────────────────────────────────────────────
  { id: "trick_pumpkin", label: "Trick Pumpkin", category: "seasonal" },
  { id: "treat_pumpkin", label: "Treat Pumpkin", category: "seasonal" },
  { id: "trick_spider", label: "Trick Spider", category: "seasonal" },
  { id: "treat_spider", label: "Treat Spider", category: "seasonal" },
  { id: "trick_skull", label: "Trick Skull", category: "seasonal" },
  { id: "treat_skull", label: "Treat Skull", category: "seasonal" },
  { id: "trick_ghost", label: "Trick Ghost", category: "seasonal" },
  { id: "treat_ghost", label: "Treat Ghost", category: "seasonal" },
  // ── QUESTS ──────────────────────────────────────────────────
  { id: "daredevil", label: "Daredevil", category: "quests" },
  { id: "lover_girl_autumn", label: "Lover Girl Autumn", category: "quests" },
  { id: "autumn_foliage", label: "Autumn Foliage", category: "quests" },
  { id: "moomoo_hood", label: "Moomoo Hood", category: "quests" },
  {
    id: "valorant_summer_kickoff",
    label: "VALORANT Summer Kickoff",
    category: "quests",
  },
  { id: "i_love_repo", label: "I Love R.E.P.O.", category: "quests" },
  {
    id: "freezer_bunny_lovebug",
    label: "Freezer Bunny Lovebug",
    category: "quests",
  },
  { id: "lego_fortnite", label: "LEGO® Fortnite", category: "quests" },
  {
    id: "fortnite_galactic_battle",
    label: "Fortnite Galactic Battle",
    category: "quests",
  },
  {
    id: "fortnite_boogie_bomb",
    label: "Fortnite Boogie Bomb",
    category: "quests",
  },
  {
    id: "street_fighter_6_battle_field",
    label: "Street Fighter 6 Battle Field",
    category: "quests",
  },
  { id: "victory_crown", label: "Fortnite Victory Crown", category: "quests" },
  { id: "marvel_snap_venom", label: "Marvel Snap Venom", category: "quests" },
  { id: "angela_avatar", label: "Angela Avatar", category: "quests" },
  { id: "jean_grey_phoenix", label: "Phoenix", category: "quests" },
  {
    id: "how_to_train_your_dragon",
    label: "How to Train Your Dragon",
    category: "quests",
  },
  { id: "dream_dive_stars", label: "Dream Dive Stars", category: "quests" },
  { id: "mecha_break", label: "Mecha BREAK", category: "quests" },
  { id: "starlight_revolver", label: "Starlight Revolver", category: "quests" },
  {
    id: "wallach_spaceport",
    label: "Wallach IX Spaceport",
    category: "quests",
  },
  {
    id: "champions_tactibear",
    label: "Champions Tactibear",
    category: "quests",
  },
  { id: "tactibear_flex", label: "Tactibear Flex", category: "quests" },
  { id: "inzoi_psycat", label: "inZOI Psycat", category: "quests" },
  { id: "cow_glider", label: "Cow Glider", category: "quests" },
  {
    id: "jeff_the_land_shark",
    label: "Jeff the Land Shark",
    category: "quests",
  },
  { id: "rift_butterfly", label: "Rift Butterfly", category: "quests" },
  { id: "wolf_morph", label: "Wolf Morph", category: "quests" },
  { id: "bunny", label: "Bunny", category: "quests" },
  { id: "forest_frolic", label: "Forest Frolic", category: "quests" },
  {
    id: "lights_camera_action_teal",
    label: "Lights, Camera, Action! (Teal)",
    category: "quests",
  },
  { id: "the_final_peel", label: "The Final Peel", category: "quests" },
  { id: "warframe_clem", label: "Warframe Clem", category: "quests" },
  { id: "dart_monkey", label: "Dart Monkey", category: "quests" },
  { id: "kom", label: "KOM", category: "quests" },
  { id: "mr_m", label: "Mr. M", category: "quests" },
  { id: "fc_26_icon", label: "FC 26 Icon", category: "quests" },
  { id: "skate", label: "skate.", category: "quests" },
  { id: "airona_fireworks", label: "Airona Fireworks", category: "quests" },
  { id: "travel_ring", label: "Travel Ring", category: "quests" },
  { id: "a_real_fungi", label: "A Real Fungi", category: "quests" },
  { id: "cab_monster", label: "Cab Monster", category: "quests" },
  { id: "black_phone_2", label: "Black Phone 2", category: "quests" },
  { id: "cosy_deer", label: "Cosy Deer", category: "quests" },
  { id: "atsus_mask", label: "Atsu's Mask", category: "quests" },
  {
    id: "lights_camera_action_orange",
    label: "Lights, Camera, Action! (Orange)",
    category: "quests",
  },
  { id: "hoppy_boi", label: "Hoppy Boi", category: "quests" },
  { id: "echo_4", label: "Echo 4", category: "quests" },
  { id: "nba_2k26", label: "NBA 2K26", category: "quests" },
  {
    id: "the_conjuring_last_rites",
    label: "The Conjuring: Last Rites",
    category: "quests",
  },
  { id: "eye_of_prophesy", label: "Eye of Prophesy", category: "quests" },
  { id: "espn", label: "ESPN", category: "quests" },
  {
    id: "wendys_x_wednesday",
    label: "Wendy’s x Wednesday",
    category: "quests",
  },
  { id: "bf_soldier_helmet", label: "BF Soldier Helmet", category: "quests" },
  { id: "bing_bong", label: "Bing Bong", category: "quests" },
  { id: "hank_hill", label: "Hank Hill", category: "quests" },
  { id: "the_entity", label: "The Entity", category: "quests" },
  { id: "descendant", label: "Descendant", category: "quests" },
  { id: "sweet_tooth", label: "Sweet Tooth", category: "quests" },
  { id: "chomp_chomp", label: "Chomp Chomp", category: "quests" },
  {
    id: "call_of_duty_mobile",
    label: "Call of Duty: Mobile",
    category: "quests",
  },
  { id: "thps_half_pipe", label: "THPS Half Pipe", category: "quests" },
  { id: "palia", label: "Palia", category: "quests" },
  { id: "supercell", label: "SuperCell", category: "quests" },
  { id: "m3gan_2_0", label: "M3GAN 2.0", category: "quests" },
  { id: "28_years_later", label: "28 Years Later", category: "quests" },
  { id: "r6_siege_x_avatar", label: "R6 Siege X Avatar", category: "quests" },
  { id: "towerborne_play", label: "Towerborne Play", category: "quests" },
  { id: "ballerina", label: "Ballerina", category: "quests" },
  { id: "ultron", label: "Ultron", category: "quests" },
  { id: "open_beta", label: "Open Beta", category: "quests" },
  {
    id: "jurassic_world_rebirth",
    label: "Jurassic World Rebirth Trailer",
    category: "quests",
  },
  {
    id: "mission_impossible",
    label: "Mission: Impossible",
    category: "quests",
  },
  { id: "bad_guys_2", label: "The Bad Guys 2 Trailer", category: "quests" },
  { id: "shield_saw", label: "Shield Saw", category: "quests" },
  { id: "friend_of_dex", label: "Friend of Dex", category: "quests" },
  { id: "hackclaw", label: "Hackclaw", category: "quests" },
  { id: "slurp_barrel", label: "Slurp Barrel", category: "quests" },
  {
    id: "signal_from_tau_ceti",
    label: "Signal from Tau Ceti",
    category: "quests",
  },
  { id: "emma_frost", label: "Emma Frost", category: "quests" },
  { id: "face_of_corruption", label: "Face of Corruption", category: "quests" },
  { id: "clicker", label: "Clicker", category: "quests" },
  { id: "touch_grass", label: "Touch Grass", category: "quests" },
  { id: "supply_llama", label: "Supply Llama", category: "quests" },
  { id: "gallica", label: "Gallica", category: "quests" },
  { id: "khazan", label: "Khazan", category: "quests" },
  { id: "split", label: "Split", category: "quests" },
  { id: "pathojen", label: "Pathojen", category: "quests" },
  { id: "big_dill_chain", label: "Big Dill Chain", category: "quests" },
  { id: "exoborne", label: "Exoborne", category: "quests" },
  { id: "scout", label: "Scout", category: "quests" },
  { id: "fuchsia_agent", label: "Fuchsia Agent", category: "quests" },
  { id: "wingmans_got_it", label: "WINGMAN'S GOT IT", category: "quests" },
  { id: "rec_room_lightning", label: "Rec Room Lightning", category: "quests" },
  { id: "shadow", label: "Shadow", category: "quests" },
  { id: "tga_controller", label: "TGA Controller", category: "quests" },
  { id: "shield_potion", label: "Shield Potion", category: "quests" },
  { id: "bush_camper", label: "Bush Camper", category: "quests" },
  { id: "batarang", label: "Batarang", category: "quests" },
  { id: "torgal_puppy", label: "Torgal Puppy", category: "quests" },
  { id: "hailey", label: "Hailey", category: "quests" },
  { id: "los_santos", label: "Los Santos", category: "quests" },
  { id: "wingman_boba", label: "Wingman Boba", category: "quests" },
  { id: "warp_helmet", label: "Warp Helmet", category: "quests" },
  { id: "mokoko", label: "Mokoko", category: "quests" },
  { id: "im_a_clown", label: "I'm a Clown", category: "quests" },
  // ── ORBS EXCLUSIVE ──────────────────────────────────────────────────
  { id: "pondering_portal", label: "Pondering Portal", category: "orbs" },
  { id: "magic_mists", label: "Magic Mists", category: "orbs" },
  { id: "pondering_portal", label: "Pondering Portal", category: "orbs" },
  { id: "infinite_swirl", label: "Infinite Swirl", category: "orbs" },
  // ── BORDERLANDS 4 ──────────────────────────────────────────────────
  { id: "im_dancin", label: "I’m Dancin’!", category: "borderlands" },
  { id: "finger_gun", label: "Finger Gun", category: "borderlands" },
  { id: "bandit_mask", label: "Bandit Mask", category: "borderlands" },
  { id: "mad_moxxi", label: "Mad Moxxi", category: "borderlands" },
  { id: "elpis", label: "Elpis", category: "borderlands" },
  { id: "loot_lightshow", label: "Loot Lightshow", category: "borderlands" },
  // ── LUNAR ECLIPSE ──────────────────────────────────────────────────
  { id: "lunar_flowers", label: "Lunar Flowers", category: "lunar_eclipse" },
  {
    id: "starlight_tiara",
    label: "Starlight Tiara",
    category: "lunar_eclipse",
  },
  { id: "astral_aura", label: "Astral Aura", category: "lunar_eclipse" },
  { id: "luna_moths", label: "Luna Moths", category: "lunar_eclipse" },
  { id: "moonlit_charms", label: "Moonlit Charms", category: "lunar_eclipse" },
  { id: "liquid_moon", label: "Liquid Moon", category: "lunar_eclipse" },
  // ── RAWR XD ──────────────────────────────────────────────────
  { id: "neon_cat_hoodie", label: "Neon Cat Hoodie", category: "rawr_xd" },
  {
    id: "neon_cat_hoodie_blue",
    label: "Neon Cat Hoodie (Blue)",
    category: "rawr_xd",
  },
  {
    id: "neon_cat_hoodie_pink",
    label: "Neon Cat Hoodie (Pink)",
    category: "rawr_xd",
  },
  {
    id: "neon_cat_hoodie_black",
    label: "Neon Cat Hoodie (Black)",
    category: "rawr_xd",
  },
  {
    id: "mischievous_kitties_hearts",
    label: "Mischievous Kitties (Hearts)",
    category: "rawr_xd",
  },
  { id: "neon_decora_hair", label: "Neon Decora Hair", category: "rawr_xd" },
  { id: "neon_spike_choker", label: "Neon Spike Choker", category: "rawr_xd" },
  {
    id: "neon_spike_choker_black",
    label: "Neon Spike Choker (Black)",
    category: "rawr_xd",
  },
  {
    id: "mischievous_kitties",
    label: "Mischievous Kitties",
    category: "rawr_xd",
  },
  {
    id: "mischievous_kitties_blue",
    label: "Mischievous Kitties (Blue)",
    category: "rawr_xd",
  },
  { id: "skully_charms", label: "Skully Charms", category: "rawr_xd" },
  { id: "rawr_xd", label: "Rawr xD", category: "rawr_xd" },
  // ── DRAGON BALL DAIMA ──────────────────────────────────────────────────
  { id: "dragon_balls", label: "Dragon Balls", category: "dragon_ball" },
  { id: "gomah", label: "Gomah", category: "dragon_ball" },
  { id: "shenron", label: "Shenron", category: "dragon_ball" },
  { id: "mini_goku", label: "Mini Goku", category: "dragon_ball" },
  { id: "mini_vegeta", label: "Mini Vegeta", category: "dragon_ball" },
  { id: "glorio", label: "Glorio", category: "dragon_ball" },
  {
    id: "mini_supreme_kai",
    label: "Mini Supreme Kai",
    category: "dragon_ball",
  },
  { id: "mini_piccolo", label: "Mini Piccolo", category: "dragon_ball" },
  { id: "panzy", label: "Panzy", category: "dragon_ball" },
  // ── SPIRIT BLOSSOM BEYOND ──────────────────────────────────────────────────
  {
    id: "spirit_blossom_springs_sett",
    label: "Spirit Blossom Springs Sett",
    category: "spirit_blossom",
  },
  {
    id: "spirit_blossom_springs",
    label: "Spirit Blossom Springs",
    category: "spirit_blossom",
  },
  {
    id: "spirit_blossom_springs_ahri",
    label: "Spirit Blossom Springs Ahri",
    category: "spirit_blossom",
  },
  {
    id: "spirit_blossom_zed",
    label: "Spirit Blossom Zed",
    category: "spirit_blossom",
  },
  {
    id: "spirit_blossom_morgana",
    label: "Spirit Blossom Morgana",
    category: "spirit_blossom",
  },
  {
    id: "spirit_blossom_karma",
    label: "Spirit Blossom Karma",
    category: "spirit_blossom",
  },
  { id: "yunara", label: "Yunara", category: "spirit_blossom" },
  // ── ZEN PROTOCOL ──────────────────────────────────────────────────
  { id: "bonsai", label: "Bonsai", category: "zen_protocol" },
  { id: "sakura_city", label: "Sakura City", category: "zen_protocol" },
  { id: "hologram_dragon", label: "Hologram Dragon", category: "zen_protocol" },
  { id: "cyber_katana", label: "Cyber Katana", category: "zen_protocol" },
  { id: "o_n_i", label: "O.N.I", category: "zen_protocol" },
  { id: "jingasa", label: "Jingasa", category: "zen_protocol" },
  // ── MY HERO ACADEMIA ──────────────────────────────────────────────────
  {
    id: "izuku_midoriya",
    label: "Izuku Midoriya",
    category: "my_hero_academia",
  },
  {
    id: "katsuki_bakugo",
    label: "Katsuki Bakugo",
    category: "my_hero_academia",
  },
  {
    id: "ochaco_uraraka",
    label: "Ochaco Uraraka",
    category: "my_hero_academia",
  },
  {
    id: "shoto_todoroki",
    label: "Shoto Todoroki",
    category: "my_hero_academia",
  },
  { id: "endeavor", label: "Endeavor", category: "my_hero_academia" },
  { id: "hawks", label: "Hawks", category: "my_hero_academia" },
  { id: "all_might", label: "All Might", category: "my_hero_academia" },
  {
    id: "tomura_shigaraki",
    label: "Tomura Shigaraki",
    category: "my_hero_academia",
  },
  // ── STAR WARS™ ──────────────────────────────────────────────────
  { id: "space_battle", label: "Space Battle", category: "star_wars" },
  {
    id: "lightsabers_blue_and_red",
    label: "Lightsabers (Blue and Red)",
    category: "star_wars",
  },
  {
    id: "lightsabers_green_and_red",
    label: "Lightsabers (Green and Red)",
    category: "star_wars",
  },
  {
    id: "r2_d2_on_tatooine",
    label: "R2-D2 on Tatooine",
    category: "star_wars",
  },
  { id: "curious_bb_8", label: "Curious BB-8", category: "star_wars" },
  { id: "yoda_on_dagobah", label: "Yoda on Dagobah", category: "star_wars" },
  {
    id: "millennium_falcon_hyperdrive",
    label: "Millennium Falcon Hyperdrive",
    category: "star_wars",
  },
  // ── JENNIE ──────────────────────────────────────────────────
  { id: "ruby_hearts", label: "Ruby Hearts", category: "jennie" },
  // ── STEAMPUNK ──────────────────────────────────────────────────
  {
    id: "steampunk_cat_ears",
    label: "Steampunk Cat Ears",
    category: "steampunk",
  },
  { id: "mech_flora", label: "Mech Flora", category: "steampunk" },
  { id: "bowler_hat", label: "Bowler Hat", category: "steampunk" },
  { id: "brass_beats", label: "Brass Beats", category: "steampunk" },
  {
    id: "timekeepers_clock",
    label: "Timekeeper's Clock",
    category: "steampunk",
  },
  { id: "flux_alchemy", label: "Flux Alchemy", category: "steampunk" },
  // ── FANTASY 2 ──────────────────────────────────────────────────
  { id: "mooncaps_pink", label: "Mooncaps (Pink)", category: "fantasy" },
  { id: "mooncaps_blue", label: "Mooncaps (Blue)", category: "fantasy" },
  {
    id: "magic_portal_purple",
    label: "Magic Portal (Purple)",
    category: "fantasy",
  },
  {
    id: "magic_portal_blue",
    label: "Magic Portal (Blue)",
    category: "fantasy",
  },
  {
    id: "fairy_sprites_pink",
    label: "Fairy Sprites (Pink)",
    category: "fantasy",
  },
  {
    id: "fairy_sprites_blue",
    label: "Fairy Sprites (Blue)",
    category: "fantasy",
  },
  { id: "fairy_sprites", label: "Fairy Sprites", category: "fantasy" },
  {
    id: "crystal_ball_purple",
    label: "Crystal Ball (Purple)",
    category: "fantasy",
  },
  {
    id: "crystal_ball_blue",
    label: "Crystal Ball (Blue)",
    category: "fantasy",
  },
  {
    id: "wizard_hat_purple",
    label: "Wizard Hat (Purple)",
    category: "fantasy",
  },
  { id: "wizard_hat_blue", label: "Wizard Hat (Blue)", category: "fantasy" },
  {
    id: "magical_wand_purple",
    label: "Magical Wand (Purple)",
    category: "fantasy",
  },
  {
    id: "magical_wand_green",
    label: "Magical Wand (Green)",
    category: "fantasy",
  },
  { id: "cottage_home", label: "Cottage Home", category: "fantasy" },
  { id: "flaming_sword", label: "Flaming Sword", category: "fantasy" },
  { id: "magical_potion", label: "Magical Potion", category: "fantasy" },
  { id: "wizards_staff", label: "Wizard's Staff", category: "fantasy" },
  { id: "glowing_runes", label: "Glowing Runes", category: "fantasy" },
  { id: "defensive_shield", label: "Defensive Shield", category: "fantasy" },
  { id: "skull_medallion", label: "Skull Medallion", category: "fantasy" },
  { id: "treasure_and_key", label: "Treasure and Key", category: "fantasy" },
  // ── FANTASY ──────────────────────────────────────────────────
  { id: "flaming_sword", label: "Flaming Sword", category: "fantasy" },
  { id: "magical_potion", label: "Magical Potion", category: "fantasy" },
  { id: "fairy_sprites", label: "Fairy Sprites", category: "fantasy" },
  { id: "wizards_staff", label: "Wizard's Staff", category: "fantasy" },
  { id: "glowing_runes", label: "Glowing Runes", category: "fantasy" },
  { id: "defensive_shield", label: "Defensive Shield", category: "fantasy" },
  { id: "skull_medallion", label: "Skull Medallion", category: "fantasy" },
  { id: "treasure_and_key", label: "Treasure and Key", category: "fantasy" },
  // ── LOFI GIRL ──────────────────────────────────────────────────
  { id: "lofi_girl_outfit", label: "Lofi Girl Outfit", category: "lofi_girl" },
  {
    id: "sleepy_chilledcow",
    label: "Sleepy ChilledCow",
    category: "lofi_girl",
  },
  { id: "playful_lofi_cat", label: "Playful Lofi Cat", category: "lofi_girl" },
  { id: "study_session", label: "Study Session", category: "lofi_girl" },
  { id: "group_hug", label: "Group Hug", category: "lofi_girl" },
  { id: "cozy_post_it", label: "Cozy Post-It", category: "lofi_girl" },
  {
    id: "cozy_post_it_festive",
    label: "Cozy Post-It (Festive)",
    category: "lofi_girl",
  },
  // ── ARCANE ──────────────────────────────────────────────────
  { id: "the_anomaly", label: "The Anomaly", category: "arcane" },
  { id: "the_mark", label: "The Mark", category: "arcane" },
  {
    id: "the_monster_you_created",
    label: "The Monster You Created",
    category: "arcane",
  },
  {
    id: "the_atlas_gauntlets",
    label: "The Atlas Gauntlets",
    category: "arcane",
  },
  { id: "flame_chompers", label: "Flame Chompers", category: "arcane" },
  { id: "fishbones", label: "FISHBONES!", category: "arcane" },
  { id: "the_hexcore", label: "The Hexcore", category: "arcane" },
  { id: "powered_by_shimmer", label: "Powered by Shimmer", category: "arcane" },
  // ── DOJO ──────────────────────────────────────────────────
  { id: "kabuto", label: "Kabuto", category: "dojo" },
  { id: "oni_mask", label: "Oni Mask", category: "dojo" },
  { id: "straw_hat", label: "Straw Hat", category: "dojo" },
  { id: "sakura_ink", label: "Sakura Ink", category: "dojo" },
  { id: "sakura_warrior", label: "Sakura Warrior", category: "dojo" },
  { id: "shurikens_mask", label: "Shuriken's Mask", category: "dojo" },
  // ── DARK FANTASY ──────────────────────────────────────────────────
  { id: "arcane_sigil", label: "Arcane Sigil", category: "dark_fantasy" },
  {
    id: "midnight_sorceress",
    label: "Midnight Sorceress",
    category: "dark_fantasy",
  },
  { id: "malefic_crown", label: "Malefic Crown", category: "dark_fantasy" },
  { id: "deaths_edge", label: "Death's Edge", category: "dark_fantasy" },
  { id: "spirit_embers", label: "Spirit Embers", category: "dark_fantasy" },
  { id: "eldritch_ring", label: "Eldritch Ring", category: "dark_fantasy" },
  // ── ARCADE ──────────────────────────────────────────────────
  { id: "joystick", label: "Joystick", category: "arcade" },
  { id: "clyde_invaders", label: "Clyde Invaders", category: "arcade" },
  { id: "pipedream", label: "Pipedream", category: "arcade" },
  { id: "hot_shot", label: "Hot Shot", category: "arcade" },
  { id: "mallow_jump", label: "Mallow Jump", category: "arcade" },
  { id: "slither_n_snack", label: "Slither 'n Snack", category: "arcade" },
  // ── GALAXY ──────────────────────────────────────────────────
  { id: "stardust", label: "Stardust", category: "galaxy" },
  { id: "black_hole", label: "Black Hole", category: "galaxy" },
  { id: "constellations", label: "Constellations", category: "galaxy" },
  { id: "solar_orbit", label: "Solar Orbit", category: "galaxy" },
  { id: "ufo", label: "UFO", category: "galaxy" },
  { id: "astronaut_helmet", label: "Astronaut Helmet", category: "galaxy" },
];

const BASE_ANIMATED = "https://discord-decoration.art/decorations";
const BASE_PREVIEW = "https://discord-decoration.art/mdecorations";

export function getDecorationUrl(id: string): string {
  return `${BASE_ANIMATED}/${id}.png`;
}

export function getDecorationPreviewUrl(id: string): string {
  return `${BASE_PREVIEW}/${id}.webp`;
}

export function isGifDecoration(style: string): boolean {
  return AVATAR_DECORATIONS.some((d) => d.id === style);
}
