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
ALTER TABLE offers ADD COLUMN IF NOT EXISTS history JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE room_clubs ADD COLUMN IF NOT EXISTS penalty_pts INT NOT NULL DEFAULT 0;
-- Calendário de mercado (leilão -> mercado com prazo -> fechado)
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS mkt_stage TEXT;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS mkt_state TEXT;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS mkt_until TIMESTAMPTZ;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS auction_excl INT[] NOT NULL DEFAULT '{}';
ALTER TABLE auction_lots ADD COLUMN IF NOT EXISTS stage TEXT;
ALTER TABLE room_players ADD COLUMN IF NOT EXISTS evo_acc REAL NOT NULL DEFAULT 0;
ALTER TABLE room_players ADD COLUMN IF NOT EXISTS ovr_start INT;
CREATE TABLE IF NOT EXISTS auction_bid_log(id SERIAL PRIMARY KEY,lot_id INT REFERENCES auction_lots(id) ON DELETE CASCADE,club_id INT,user_id INT,amount BIGINT,created_at TIMESTAMPTZ DEFAULT now());
ALTER TABLE lineups ADD COLUMN IF NOT EXISTS tactics JSONB;
ALTER TABLE lineups ADD COLUMN IF NOT EXISTS takers JSONB;
ALTER TABLE lineups ADD COLUMN IF NOT EXISTS slotted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE room_players ADD COLUMN IF NOT EXISTS shielded BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE room_players ADD COLUMN IF NOT EXISTS shielded_at TIMESTAMPTZ;
UPDATE room_players SET shielded_at=now() WHERE shielded AND shielded_at IS NULL;
-- Blindagem: no máximo 3 por clube (mantém os 3 blindados primeiro)
UPDATE room_players r SET shielded=false,shielded_at=NULL FROM (SELECT room_id,player_id,row_number() OVER (PARTITION BY room_id,club_id ORDER BY shielded_at,player_id) n FROM room_players WHERE shielded) x WHERE r.room_id=x.room_id AND r.player_id=x.player_id AND x.n>3;
-- 25/10: reverte reforços fora BR/ARG (ids 97000000+ e 4 jogadores movidos do FC27)
DELETE FROM offers WHERE (player_id BETWEEN 97000000 AND 97999999) OR (swap_player_id BETWEEN 97000000 AND 97999999);
DELETE FROM negotiations WHERE player_id BETWEEN 97000000 AND 97999999;
DELETE FROM watchlist WHERE player_id BETWEEN 97000000 AND 97999999;
DELETE FROM auction_lots WHERE player_id BETWEEN 97000000 AND 97999999;
DELETE FROM transfers WHERE player_id BETWEEN 97000000 AND 97999999;
DELETE FROM player_stats WHERE player_id BETWEEN 97000000 AND 97999999;
DELETE FROM room_players WHERE player_id BETWEEN 97000000 AND 97999999;
UPDATE lineups SET starters=ARRAY(SELECT x FROM unnest(starters) x WHERE x NOT BETWEEN 97000000 AND 97999999),slotted=false WHERE EXISTS(SELECT 1 FROM unnest(starters) x WHERE x BETWEEN 97000000 AND 97999999);
UPDATE room_players r SET club_id=v.orig FROM (VALUES(211302,358,118),(226286,339,118),(258846,261,655),(275257,339,57)) v(pid,moved,orig) WHERE r.player_id=v.pid AND r.club_id=v.moved AND NOT EXISTS(SELECT 1 FROM transfers t WHERE t.room_id=r.room_id AND t.player_id=r.player_id);
-- 25/10: Sorteio Libertadores ZC (uma vez só): limpa overrides antigos dos 30 jogadores sorteados
CREATE TABLE IF NOT EXISTS zc_migs(name TEXT PRIMARY KEY,at TIMESTAMPTZ DEFAULT now());
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM zc_migs WHERE name='sorteio2510') THEN
 UPDATE room_players r SET club_id=v.cid,shielded=false,shielded_at=NULL,listed=false FROM (VALUES(143076,506,234),(227153,166,746),(210513,339,118),(205632,73,667),(210822,167,118),(226385,676,633),(214584,676,692),(259848,774,577),(241907,774,667),(230977,707,609),(176919,707,736),(240471,261,736),(233084,261,480),(233092,274,509),(247450,274,117),(197655,358,774),(188803,358,630),(220523,358,496),(215076,245,510),(221342,245,621),(176550,245,118),(184941,243,610),(238896,243,389),(186537,243,662),(200752,315,222),(235949,315,604),(213991,315,207),(211625,185,681),(214026,185,369),(216816,185,402)) v(pid,cid,old) WHERE r.player_id=v.pid;
 UPDATE lineups l SET starters=ARRAY(SELECT x FROM unnest(l.starters) x WHERE x NOT IN (214584,197655)),slotted=false WHERE l.club_id IN (692,774) AND l.starters && ARRAY[214584,197655];
 UPDATE offers SET status='rejected' WHERE player_id IN (SELECT pid FROM (VALUES(143076,506,234),(227153,166,746),(210513,339,118),(205632,73,667),(210822,167,118),(226385,676,633),(214584,676,692),(259848,774,577),(241907,774,667),(230977,707,609),(176919,707,736),(240471,261,736),(233084,261,480),(233092,274,509),(247450,274,117),(197655,358,774),(188803,358,630),(220523,358,496),(215076,245,510),(221342,245,621),(176550,245,118),(184941,243,610),(238896,243,389),(186537,243,662),(200752,315,222),(235949,315,604),(213991,315,207),(211625,185,681),(214026,185,369),(216816,185,402)) v(pid,cid,old)) AND status IN ('pending','countered','club_accepted');
 INSERT INTO zc_migs(name) VALUES('sorteio2510');
END IF; END $$;
