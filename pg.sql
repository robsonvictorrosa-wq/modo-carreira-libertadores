CREATE TABLE IF NOT EXISTS users(id SERIAL PRIMARY KEY,nick TEXT UNIQUE NOT NULL,pass_hash TEXT NOT NULL,created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INT REFERENCES users(id) ON DELETE CASCADE,created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS rooms(id SERIAL PRIMARY KEY,code TEXT UNIQUE NOT NULL,name TEXT NOT NULL,owner_id INT REFERENCES users(id),max_managers INT NOT NULL DEFAULT 5,season INT NOT NULL DEFAULT 2026,status TEXT NOT NULL DEFAULT 'lobby',version INT NOT NULL DEFAULT 1,created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS room_managers(room_id INT REFERENCES rooms(id) ON DELETE CASCADE,user_id INT REFERENCES users(id),club_id INT,joined_at TIMESTAMPTZ DEFAULT now(),PRIMARY KEY(room_id,user_id));
CREATE UNIQUE INDEX IF NOT EXISTS rm_club ON room_managers(room_id,club_id) WHERE club_id IS NOT NULL;
-- estado mutável por sala: clubes copiados na criação; jogadores copy-on-write (só quem muda)
CREATE TABLE IF NOT EXISTS room_clubs(room_id INT REFERENCES rooms(id) ON DELETE CASCADE,club_id INT,budget BIGINT,wage_budget BIGINT,PRIMARY KEY(room_id,club_id));
CREATE TABLE IF NOT EXISTS room_players(room_id INT REFERENCES rooms(id) ON DELETE CASCADE,player_id INT,club_id INT,overall INT,potential INT,age INT,wage BIGINT,market_value BIGINT,contract_end INT,PRIMARY KEY(room_id,player_id));
CREATE TABLE IF NOT EXISTS room_events(id SERIAL PRIMARY KEY,room_id INT REFERENCES rooms(id) ON DELETE CASCADE,text TEXT,created_at TIMESTAMPTZ DEFAULT now());
-- Etapa 3: temporada
ALTER TABLE room_managers ADD COLUMN IF NOT EXISTS ready BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS competitions(id SERIAL PRIMARY KEY,room_id INT REFERENCES rooms(id) ON DELETE CASCADE,season INT,league_id INT,name TEXT,rounds_total INT,current_round INT NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS matches(id SERIAL PRIMARY KEY,comp_id INT REFERENCES competitions(id) ON DELETE CASCADE,round INT,home INT,away INT,hg INT,ag INT,played BOOLEAN NOT NULL DEFAULT false,details JSONB);
CREATE INDEX IF NOT EXISTS m_comp ON matches(comp_id,round);
CREATE TABLE IF NOT EXISTS player_stats(comp_id INT REFERENCES competitions(id) ON DELETE CASCADE,player_id INT,club_id INT,apps INT DEFAULT 0,goals INT DEFAULT 0,assists INT DEFAULT 0,rating_sum REAL DEFAULT 0,PRIMARY KEY(comp_id,player_id));
CREATE TABLE IF NOT EXISTS lineups(room_id INT REFERENCES rooms(id) ON DELETE CASCADE,club_id INT,formation TEXT,starters INT[],PRIMARY KEY(room_id,club_id));
-- Etapa 4: mercado
ALTER TABLE room_players ADD COLUMN IF NOT EXISTS release_clause BIGINT;
ALTER TABLE room_players ADD COLUMN IF NOT EXISTS morale INT;
ALTER TABLE room_players ADD COLUMN IF NOT EXISTS wants_out BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE room_players ADD COLUMN IF NOT EXISTS listed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE room_players ADD COLUMN IF NOT EXISTS loan_from INT;
ALTER TABLE room_players ADD COLUMN IF NOT EXISTS role TEXT;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS window_override TEXT;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS market_day INT NOT NULL DEFAULT 0;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS window_was_open BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE room_events ADD COLUMN IF NOT EXISTS user_id INT;
CREATE TABLE IF NOT EXISTS offers(id SERIAL PRIMARY KEY,room_id INT REFERENCES rooms(id) ON DELETE CASCADE,player_id INT,buyer_club INT,seller_club INT,buyer_user INT,seller_user INT,fee BIGINT DEFAULT 0,swap_player_id INT,loan BOOLEAN NOT NULL DEFAULT false,wage BIGINT,role TEXT,years INT,status TEXT NOT NULL,counter_fee BIGINT,counter_wage BIGINT,bot_max BIGINT,counters INT NOT NULL DEFAULT 0,reason TEXT,deadline_day INT,created_day INT,created_at TIMESTAMPTZ DEFAULT now(),updated_at TIMESTAMPTZ DEFAULT now());
CREATE INDEX IF NOT EXISTS of_room ON offers(room_id,status);
CREATE TABLE IF NOT EXISTS negotiations(room_id INT REFERENCES rooms(id) ON DELETE CASCADE,buyer_club INT,player_id INT,club_fails INT NOT NULL DEFAULT 0,player_fails INT NOT NULL DEFAULT 0,blocked_until INT NOT NULL DEFAULT -1,PRIMARY KEY(room_id,buyer_club,player_id));
CREATE TABLE IF NOT EXISTS transfers(id SERIAL PRIMARY KEY,room_id INT REFERENCES rooms(id) ON DELETE CASCADE,season INT,day INT,player_id INT,from_club INT,to_club INT,fee BIGINT,wage BIGINT,kind TEXT,human BOOLEAN NOT NULL DEFAULT false,created_at TIMESTAMPTZ DEFAULT now());
CREATE INDEX IF NOT EXISTS tr_room ON transfers(room_id,id DESC);
CREATE TABLE IF NOT EXISTS watchlist(room_id INT REFERENCES rooms(id) ON DELETE CASCADE,user_id INT,player_id INT,PRIMARY KEY(room_id,user_id,player_id));
-- Libertadores ZC
ALTER TABLE matches ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'league';
ALTER TABLE matches ADD COLUMN IF NOT EXISTS leg INT NOT NULL DEFAULT 0;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS tie INT;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS winner INT;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS pens TEXT;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS neutral BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS champion INT;
CREATE TABLE IF NOT EXISTS bolao(room_id INT REFERENCES rooms(id) ON DELETE CASCADE,match_id INT REFERENCES matches(id) ON DELETE CASCADE,user_id INT REFERENCES users(id) ON DELETE CASCADE,hg INT NOT NULL,ag INT NOT NULL,updated_at TIMESTAMPTZ DEFAULT now(),PRIMARY KEY(room_id,match_id,user_id));

-- Zero Clubistas: leilão e premiações
CREATE TABLE IF NOT EXISTS auction_lots(id SERIAL PRIMARY KEY,room_id INT REFERENCES rooms(id) ON DELETE CASCADE,season INT,player_id INT,from_club INT,min_bid BIGINT,status TEXT NOT NULL DEFAULT 'open',winner_club INT,price BIGINT,created_round INT);
  CREATE TABLE IF NOT EXISTS auction_bids(lot_id INT REFERENCES auction_lots(id) ON DELETE CASCADE,club_id INT,user_id INT,amount BIGINT,created_at TIMESTAMPTZ DEFAULT now(),PRIMARY KEY(lot_id,club_id));
  ALTER TABLE competitions ADD COLUMN IF NOT EXISTS prizes_paid BOOLEAN NOT NULL DEFAULT false;
-- Rodada 3: administradores, leilão manual, empréstimos por rodadas
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS auction_open BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE room_players ADD COLUMN IF NOT EXISTS loan_until INT;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS loan_rounds INT;
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ok';
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS contested_by TEXT;
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS contested_at TIMESTAMPTZ;
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS cancelled_by TEXT;
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE transfers ADD COLUMN IF NOT EXISTS prev JSONB;
UPDATE transfers SET created_at=now() WHERE created_at IS NULL;
