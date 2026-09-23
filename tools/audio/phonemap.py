"""espeak-IPA (wav2vec2-espeak vocab) -> ARPAbet mapping and helpers."""
IPA2ARPA = {
    # vowels
    "ɑː": "AA", "ɑ": "AA", "a": "AA", "aː": "AA", "æ": "AE", "ʌ": "AH", "ə": "AH", "ɐ": "AH",
    "ɔː": "AO", "ɔ": "AO", "ɒ": "AO", "ɛ": "EH", "ɜː": "ER", "ɜ": "ER", "ɚ": "ER", "ɝ": "ER",
    "ɪ": "IH", "ᵻ": "IH", "iː": "IY", "i": "IY", "oʊ": "OW", "o": "OW", "oː": "OW", "əʊ": "OW",
    "ʊ": "UH", "uː": "UW", "u": "UW", "aɪ": "AY", "eɪ": "EY", "e": "EY", "eː": "EY",
    "ɔɪ": "OY", "oɪ": "OY", "aʊ": "AW",
    # consonants
    "p": "P", "b": "B", "t": "T", "d": "D", "k": "K", "ɡ": "G", "f": "F", "v": "V",
    "θ": "TH", "ð": "DH", "s": "S", "z": "Z", "ʃ": "SH", "ʒ": "ZH", "h": "HH", "m": "M",
    "n": "N", "ŋ": "NG", "l": "L", "ɹ": "R", "r": "R", "w": "W", "j": "Y", "tʃ": "CH",
    "dʒ": "JH", "ɾ": "DX",
}
# multi-phone tokens
IPA2ARPA_SEQ = {"əl": ["AH", "L"], "ɑːɹ": ["AA", "R"], "ɔːɹ": ["AO", "R"], "ɛɹ": ["EH", "R"],
                "ɪɹ": ["IH", "R"], "ʊɹ": ["UH", "R"], "oːɹ": ["AO", "R"], "aɪɚ": ["AY", "ER"],
                "aɪə": ["AY", "AH"], "iə": ["IY", "AH"], "ts": ["T", "S"]}
VOWELS = ["AA", "AE", "AH", "AO", "EH", "ER", "IH", "IY", "OW", "UH", "UW", "AY", "EY", "OY", "AW"]
ROMAN = {"AA": "a", "AE": "ae", "AH": "uh", "AO": "aw", "EH": "e", "ER": "er", "IH": "i", "IY": "ee",
         "OW": "o", "UH": "uu", "UW": "oo", "AY": "ai", "EY": "ay", "OY": "oy", "AW": "ow",
         "B": "b", "CH": "ch", "D": "d", "DH": "dh", "F": "f", "G": "g", "HH": "h", "JH": "j",
         "K": "k", "L": "l", "M": "m", "N": "n", "NG": "ng", "P": "p", "R": "r", "S": "s",
         "SH": "sh", "T": "t", "TH": "th", "V": "v", "W": "w", "Y": "y", "Z": "z", "ZH": "zh",
         "DX": "d"}


def to_arpa(tok):
    if tok in IPA2ARPA:
        return [IPA2ARPA[tok]]
    if tok in IPA2ARPA_SEQ:
        return IPA2ARPA_SEQ[tok]
    return []


def romanize(phones):
    return "".join(ROMAN.get(p, p.lower()) for p in phones)

# en-us espeak inventory: CTC decoding is restricted to these tokens (plus blank) so the
# multilingual model cannot drift into e.g. Mandarin tone tokens or continental 'a'/'o'.
EN_TOKENS = {
    "ə", "ɚ", "ɪ", "ᵻ", "i", "iː", "ɛ", "æ", "ɑː", "ɔː", "ɔ", "ʌ", "ʊ", "u", "uː", "aɪ", "eɪ",
    "oʊ", "aʊ", "ɔɪ", "ɜː", "ɐ", "əl", "oːɹ", "ɔːɹ", "ɑːɹ", "ɛɹ", "ɪɹ", "ʊɹ", "aɪɚ", "aɪə", "iə",
    "p", "b", "t", "d", "k", "ɡ", "f", "v", "θ", "ð", "s", "z", "ʃ", "ʒ", "h", "m", "n", "ŋ",
    "l", "ɹ", "w", "j", "tʃ", "dʒ", "ɾ", "ʔ",
}
