CREATE TABLE deleted_cards (
  card_type TEXT NOT NULL CHECK (card_type IN ('category', 'topic')),
  id TEXT NOT NULL,
  deleted_at TEXT NOT NULL,
  PRIMARY KEY (card_type, id)
);
