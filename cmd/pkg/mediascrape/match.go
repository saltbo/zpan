package mediascrape

import (
	"regexp"
	"strconv"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

// How a parsed title is matched to a TMDB search result, with the same rules
// as the server (server/domain/tmdb.ts). Titles are compared after
// normalization, so punctuation, case, accents, `&` versus "and", and a leading
// English article do not matter, and a result whose year is more than one off
// never matches.

// TitleMatchThreshold is the Dice similarity of normalized titles at or above
// which a search result can match.
const TitleMatchThreshold = 0.85

// SearchHit is one TMDB search result. Year is 0 when TMDB has no date.
type SearchHit struct {
	ID            int
	Title         string
	OriginalTitle string
	Year          int
}

var (
	nonAlnum       = regexp.MustCompile(`[^\p{L}\p{N}]+`)
	leadingArticle = regexp.MustCompile(`^ ?(?:the|a|an) `)
	trailingDigits = regexp.MustCompile(`(\d+)$`)
	trailingRoman  = regexp.MustCompile(` (x{0,3}(?:ix|iv|v?i{0,3}))$`)
)

func titleWords(title string) string {
	var b strings.Builder
	for _, r := range norm.NFKD.String(title) {
		if unicode.Is(unicode.M, r) {
			continue
		}
		b.WriteRune(r)
	}
	words := strings.ToLower(b.String())
	words = strings.ReplaceAll(words, "&", " and ")
	return nonAlnum.ReplaceAllString(words, " ")
}

// NormalizeTitle is the form titles are compared in.
func NormalizeTitle(title string) string {
	return strings.ReplaceAll(leadingArticle.ReplaceAllString(titleWords(title), ""), " ", "")
}

// sequelNumber is the number a title ends with, in digits or as a roman
// numeral after a space: the sequel or part a title names. "Toy Story 2" and
// "Toy Story 3" are as similar as two titles get, so this has to agree before
// similarity counts. CJK titles run the number into the last word
// ("唐人街探案2"). ok is false for a title without one.
func sequelNumber(title string) (int, bool) {
	words := strings.TrimSpace(titleWords(title))
	if m := trailingDigits.FindStringSubmatch(words); m != nil {
		value, err := strconv.Atoi(m[1])
		if err != nil {
			return 0, false
		}
		return value, true
	}
	if m := trailingRoman.FindStringSubmatch(words); m != nil && m[1] != "" {
		return romanValue(m[1]), true
	}
	return 0, false
}

var romanDigits = map[byte]int{'i': 1, 'v': 5, 'x': 10}

func romanValue(numeral string) int {
	value := 0
	for i := 0; i < len(numeral); i++ {
		digit := romanDigits[numeral[i]]
		next := 0
		if i+1 < len(numeral) {
			next = romanDigits[numeral[i+1]]
		}
		if digit < next {
			value -= digit
		} else {
			value += digit
		}
	}
	return value
}

// TitleSimilarity is the Dice coefficient over character bigrams of the
// normalized titles: 1 when they are equal, 0 when either is empty or they
// share no bigram.
func TitleSimilarity(a, b string) float64 {
	left := []rune(NormalizeTitle(a))
	right := []rune(NormalizeTitle(b))
	if len(left) == 0 || len(right) == 0 {
		return 0
	}
	if string(left) == string(right) {
		return 1
	}
	if len(left) < 2 || len(right) < 2 {
		return 0
	}
	counts := map[string]int{}
	for i := 0; i < len(left)-1; i++ {
		counts[string(left[i:i+2])]++
	}
	shared := 0
	for i := 0; i < len(right)-1; i++ {
		bigram := string(right[i : i+2])
		if counts[bigram] > 0 {
			shared++
			counts[bigram]--
		}
	}
	return float64(2*shared) / float64(len(left)-1+len(right)-1)
}

// ChooseMatch picks the best result for a parsed title: the most similar
// title (localized or original) that ends in the same sequel number, then the
// closest year, then TMDB's own order. A result more than a year off the
// parsed year never matches; a missing year on either side is neutral.
func ChooseMatch(title string, year int, hits []SearchHit) (SearchHit, bool) {
	sequel, hasSequel := sequelNumber(title)
	var best SearchHit
	bestSimilarity, bestDistance := -1.0, 0
	for _, hit := range hits {
		similarity := 0.0
		for _, candidate := range []string{hit.Title, hit.OriginalTitle} {
			number, has := sequelNumber(candidate)
			if has != hasSequel || number != sequel {
				continue
			}
			if s := TitleSimilarity(title, candidate); s > similarity {
				similarity = s
			}
		}
		if similarity < TitleMatchThreshold {
			continue
		}
		distance := 1
		if year != 0 && hit.Year != 0 {
			distance = abs(year - hit.Year)
		}
		if distance > 1 {
			continue
		}
		if similarity > bestSimilarity || (similarity == bestSimilarity && distance < bestDistance) {
			best, bestSimilarity, bestDistance = hit, similarity, distance
		}
	}
	return best, bestSimilarity >= 0
}

func abs(value int) int {
	if value < 0 {
		return -value
	}
	return value
}

// Image is one TMDB image. Language is the ISO 639-1 code, or "" for an image
// without text.
type Image struct {
	Path     string
	Language string
}

// imageLanguage turns `zh-CN` into `zh`: TMDB tags images with ISO 639-1 only.
func imageLanguage(language string) string {
	return strings.ToLower(strings.SplitN(language, "-", 2)[0])
}

// chooseImage returns the first image in TMDB's order whose language comes
// earliest in preference ("" means an image without text).
func chooseImage(images []Image, preference []string) string {
	for _, language := range preference {
		for _, image := range images {
			if image.Language == language {
				return image.Path
			}
		}
	}
	return ""
}

// Posters carry the title, so the configured language comes first; fanart is
// a backdrop, best without text.
func posterPreference(language string) []string {
	return []string{imageLanguage(language), "", "en"}
}

func fanartPreference(language string) []string {
	return []string{"", imageLanguage(language), "en"}
}
