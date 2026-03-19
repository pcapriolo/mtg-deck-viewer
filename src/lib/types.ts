import { DeckEntry } from "./parser";
import { ScryfallCard } from "./scryfall";

export interface ResolvedEntry {
  entry: DeckEntry;
  card: ScryfallCard;
}
