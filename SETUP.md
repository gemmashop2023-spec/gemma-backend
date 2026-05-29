-- ═══════════════════════════════════════════════════════════
--  GEMMA Warehouse Manager — Schema PostgreSQL (Supabase)
--  Incolla questo nell'editor SQL di Supabase → Run
-- ═══════════════════════════════════════════════════════════

create extension if not exists "uuid-ossp";

-- ORDINI AMAZON
create table if not exists ordini_amazon (
  id                   text primary key,
  numero_ordine        text unique not null,
  prodotto             text,
  sku                  text,
  cliente              text,
  marketplace          text default 'Amazon.it',
  totale               numeric(10,2),
  valuta               text default 'EUR',
  scadenza_evasione    timestamptz,
  stato                text default 'da-acquistare',
  tracking             text,
  flag_spedito         boolean default false,
  flag_consegnato      boolean default false,
  flag_verificato_24h  boolean default false,
  acq_id               text,
  acq_piattaforma      text,
  acq_venditore        text,
  acq_prezzo           numeric(10,2),
  acq_tracking         text,
  acq_stato            text,
  acq_destinazione     text default 'verso-magazzino',
  data_ordine          timestamptz,
  indirizzo_consegna   text,
  amazon_status        text,
  data_spedizione      timestamptz,
  data_consegna        timestamptz,
  data_completato      timestamptz,
  creato_il            timestamptz default now(),
  aggiornato_il        timestamptz default now()
);

-- ORDINI EBAY
create table if not exists ordini_ebay (
  id                   text primary key,
  numero_ordine        text unique not null,
  prodotto             text,
  sku                  text,
  cliente              text,
  totale               numeric(10,2),
  valuta               text default 'EUR',
  stato                text default 'da-spedire',
  tracking             text,
  data_ordine          timestamptz,
  indirizzo_consegna   text,
  ebay_status          text,
  creato_il            timestamptz default now(),
  aggiornato_il        timestamptz default now()
);

-- ACQUISTI (manuali)
create table if not exists acquisti (
  id                   text primary key,
  data                 timestamptz default now(),
  piattaforma          text,
  prodotto             text,
  venditore            text,
  prezzo               numeric(10,2),
  destinazione         text default 'verso-magazzino',
  indirizzo_consegna   text,
  tracking             text,
  stato                text default 'non-spedito',
  contestazione_id     text,
  ordine_vendita       text,
  note                 text,
  creato_il            timestamptz default now(),
  aggiornato_il        timestamptz default now()
);

-- RESI CLIENTI
create table if not exists resi_clienti (
  id                   text primary key,
  data_richiesta       timestamptz default now(),
  canale               text,
  ordine_vendita       text,
  prodotto             text,
  cliente              text,
  motivo               text,
  valore               numeric(10,2),
  tracking_reso        text,
  stato                text default 'in-attesa',
  destinazione         text,
  rimborso_emesso      numeric(10,2),
  pratica_assic_id     text,
  note                 text,
  aggiornato_il        timestamptz default now()
);

-- RIMBORSI ASSICURATIVI
create table if not exists rimborsi_assicurativi (
  id                   text primary key,
  data_apertura        timestamptz default now(),
  reso_id              text,
  ordine_vendita       text,
  prodotto             text,
  soggetto             text default 'xCover',
  tipo_sinistro        text default 'Danno da trasporto',
  importo_richiesto    numeric(10,2),
  importo_rimborsato   numeric(10,2),
  stato                text default 'inviata',
  allegati             text,
  note                 text,
  data_chiusura        timestamptz,
  aggiornato_il        timestamptz default now()
);

-- CONTESTAZIONI
create table if not exists contestazioni (
  id                   text primary key,
  data                 timestamptz default now(),
  acquisto_id          text,
  prodotto             text,
  piattaforma          text,
  motivo               text,
  importo              numeric(10,2),
  rimborso_parziale    numeric(10,2),
  rimborso_totale      numeric(10,2),
  stato                text default 'aperta',
  reso_id              text,
  note                 text,
  aggiornato_il        timestamptz default now()
);

-- RESI A VENDITORI
create table if not exists resi_venditori (
  id                   text primary key,
  data                 timestamptz default now(),
  contestazione_id     text,
  acquisto_id          text,
  prodotto             text,
  venditore            text,
  piattaforma          text,
  valore               numeric(10,2),
  corriere             text,
  tracking_reso        text,
  stato                text default 'in-transito',
  note                 text,
  aggiornato_il        timestamptz default now()
);

-- MAGAZZINO
create table if not exists magazzino (
  id                   text primary key,
  sku                  text unique not null,
  prodotto             text not null,
  categoria            text,
  condizione           text default 'Nuovo',
  quantita             integer default 0,
  soglia_minima        integer default 1,
  posizione            text,
  costo_acquisto       numeric(10,2),
  spese_logistiche     numeric(10,2) default 0,
  costo_totale         numeric(10,2),
  prezzo_vendita       numeric(10,2),
  in_assistenza        boolean default false,
  assist_id            text,
  note                 text,
  aggiornato_il        timestamptz default now()
);

-- MOVIMENTI MAGAZZINO
create table if not exists movimenti (
  id                   text primary key,
  data                 timestamptz default now(),
  tipo                 text,
  sku                  text,
  prodotto             text,
  quantita             integer,
  valore_unitario      numeric(10,2),
  causale              text,
  ordine_vendita       text,
  ordine_acquisto      text,
  stato_prodotto       text,
  operatore            text
);

-- ASSISTENZA
create table if not exists assistenza (
  id                   text primary key,
  sku                  text,
  prodotto             text,
  motivo               text,
  centro               text,
  data_invio           timestamptz,
  data_rientro_prevista timestamptz,
  costo_stimato        numeric(10,2),
  stato                text default 'in-assistenza',
  note                 text,
  aggiornato_il        timestamptz default now()
);

-- FULFILLMENT
create table if not exists fulfillment (
  id                   text primary key,
  ordine_amazon        text,
  prodotto             text,
  stato                text default 'da-approvvigionare',
  tracking             text,
  scadenza_48h         timestamptz,
  alert                boolean default false,
  note                 text,
  creato_il            timestamptz default now(),
  aggiornato_il        timestamptz default now()
);

-- RIMBORSI AMAZON
create table if not exists rimborsi_amazon (
  id                   text primary key,
  ordine_id            text,
  importo              numeric(10,2),
  data                 timestamptz,
  motivo               text,
  stato                text default 'da-classificare',
  flag                 text,
  note                 text,
  aggiornato_il        timestamptz default now()
);

-- CANCELLAZIONI
create table if not exists cancellazioni (
  id                   text primary key,
  data                 timestamptz default now(),
  ordine_id            text,
  prodotto             text,
  stato_gestione       text default 'da-gestire',
  note                 text,
  aggiornato_il        timestamptz default now()
);

-- FORNITORI
create table if not exists fornitori (
  id                   text primary key,
  nome                 text not null,
  tipo                 text,
  contatto             text,
  email                text,
  telefono             text,
  totale_acquistato    numeric(10,2) default 0,
  note                 text,
  creato_il            timestamptz default now()
);

-- LOG SINCRONIZZAZIONI
create table if not exists log_sync (
  id                   text primary key,
  piattaforma          text,
  inizio               timestamptz,
  fine                 timestamptz,
  nuovi                integer default 0,
  aggiornati           integer default 0,
  cancellazioni        integer default 0,
  esito                text,
  errore               text
);

-- Trigger aggiornato_il automatico
create or replace function update_aggiornato_il()
returns trigger as $$
begin new.aggiornato_il = now(); return new; end;
$$ language plpgsql;
