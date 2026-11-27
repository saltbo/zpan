package mediascrape

import (
	"regexp"
	"strconv"
	"strings"
)

// The filename conventions of release groups and media servers, with the same
// rules as the server's library index (server/domain/media-filename.ts).
// Separators around tokens are any of . _ - space and brackets. Go's regexp
// has no lookahead, so each pattern is anchored at a candidate position and
// the characters around it are checked by hand.

// Kind is what a video file name says it is.
type Kind string

const (
	KindMovie   Kind = "movie"
	KindEpisode Kind = "episode"
	KindUnknown Kind = "unknown"
)

// Info is the parse of one video name. Year is 0 when the name has none.
type Info struct {
	Kind    Kind
	Title   string
	Year    int
	Season  int
	Episode int
}

var (
	seasonEpisode = regexp.MustCompile(`^(?i)S(\d{1,2})[.\s_\-()\[\]]?E(\d{1,3})`)
	crossEpisode  = regexp.MustCompile(`^(?i)(\d{1,2})x(\d{2,3})`)
	chineseEp     = regexp.MustCompile(`第\s*(\d{1,2})\s*季\s*第\s*(\d{1,4})\s*[集话話]`)
	seasonFolder  = regexp.MustCompile(`(?i)^(?:season|series|s)\s*\d+$|^第\s*\S+\s*季$|^specials?$`)
	extension     = regexp.MustCompile(`(?i)\.[a-z0-9]{2,5}$`)
	dotsAndUnders = regexp.MustCompile(`[._]+`)
	spaces        = regexp.MustCompile(`\s+`)
	edgePunct     = regexp.MustCompile(`^[\s\-–—:(\[{]+|[\s\-–—:(\[{]+$`)
	nextIsEpisode = regexp.MustCompile(`^(?i)E\d`)
)

func isSeparator(b byte) bool {
	switch b {
	case '.', ' ', '\t', '\n', '\r', '\f', '\v', '_', '-', '(', ')', '[', ']':
		return true
	}
	return false
}

// boundaryBefore reports whether a token may start at i: the start of the
// text, or right after a separator. It returns where the match begins, which
// includes that separator, the way the server's patterns consume it.
func boundaryBefore(text string, i int) (int, bool) {
	if i == 0 {
		return 0, true
	}
	if isSeparator(text[i-1]) {
		return i - 1, true
	}
	return 0, false
}

func boundaryAfter(text string, end int) bool {
	return end == len(text) || isSeparator(text[end])
}

// ParseFilename parses a video file name.
func ParseFilename(fileName string) Info {
	base := extension.ReplaceAllString(fileName, "")

	if start, season, episode, ok := findEpisode(base); ok {
		show := TitleAndYear(base[:start])
		return Info{Kind: KindEpisode, Title: show.Title, Year: show.Year, Season: season, Episode: episode}
	}

	movie := TitleAndYear(base)
	if movie.Year != 0 {
		return Info{Kind: KindMovie, Title: movie.Title, Year: movie.Year}
	}
	return Info{Kind: KindUnknown, Title: base}
}

// findEpisode tries the three episode patterns in order, each at its leftmost
// position, and returns where the match starts and its numbers.
func findEpisode(base string) (int, int, int, bool) {
	for i := 0; i < len(base); i++ {
		start, ok := boundaryBefore(base, i)
		if !ok {
			continue
		}
		loc := seasonEpisode.FindStringSubmatchIndex(base[i:])
		if loc == nil {
			continue
		}
		end := i + loc[1]
		if !boundaryAfter(base, end) && !nextIsEpisode.MatchString(base[end:]) {
			continue
		}
		return start, atoi(base[i+loc[2] : i+loc[3]]), atoi(base[i+loc[4] : i+loc[5]]), true
	}
	for i := 0; i < len(base); i++ {
		start, ok := boundaryBefore(base, i)
		if !ok {
			continue
		}
		loc := crossEpisode.FindStringSubmatchIndex(base[i:])
		if loc == nil || !boundaryAfter(base, i+loc[1]) {
			continue
		}
		return start, atoi(base[i+loc[2] : i+loc[3]]), atoi(base[i+loc[4] : i+loc[5]]), true
	}
	if loc := chineseEp.FindStringSubmatchIndex(base); loc != nil {
		return loc[0], atoi(base[loc[2]:loc[3]]), atoi(base[loc[4]:loc[5]]), true
	}
	return 0, 0, 0, false
}

// ParsePath parses a video inside a download. folders lists the folder names
// from the download's root folder down to the video's parent; a bare
// `S01E02.mkv` takes its show title from the nearest folder that is not a
// season folder.
func ParsePath(folders []string, fileName string) Info {
	info := ParseFilename(fileName)
	if info.Kind != KindEpisode || info.Title != "" {
		return info
	}
	for i := len(folders) - 1; i >= 0; i-- {
		if IsSeasonFolder(folders[i]) {
			continue
		}
		show := TitleAndYear(folders[i])
		info.Title = show.Title
		info.Year = show.Year
		return info
	}
	return info
}

// IsSeasonFolder reports `Season 1`, `S01`, `Series 2`, `第1季`, `第一季`, and `Specials`.
func IsSeasonFolder(name string) bool {
	return seasonFolder.MatchString(strings.TrimSpace(name))
}

// TitleYear is a title and its year, 0 when there is none.
type TitleYear struct {
	Title string
	Year  int
}

// TitleAndYear splits a release name into its title and year. The last year
// token with a non-empty title before it wins, so a title that is itself a
// year ("1917.2019", "Blade.Runner.2049.2017") keeps its year in the title.
func TitleAndYear(text string) TitleYear {
	var found *TitleYear
	for i := 0; i+4 <= len(text); i++ {
		start, ok := boundaryBefore(text, i)
		if !ok || !isYear(text[i:i+4]) || !boundaryAfter(text, i+4) {
			continue
		}
		if title := cleanTitle(text[:start]); title != "" {
			found = &TitleYear{Title: title, Year: atoi(text[i : i+4])}
		}
	}
	if found != nil {
		return *found
	}
	return TitleYear{Title: cleanTitle(text)}
}

func isYear(token string) bool {
	if !(strings.HasPrefix(token, "19") || strings.HasPrefix(token, "20")) {
		return false
	}
	for _, c := range token[2:] {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

func cleanTitle(text string) string {
	text = dotsAndUnders.ReplaceAllString(text, " ")
	text = spaces.ReplaceAllString(text, " ")
	return edgePunct.ReplaceAllString(text, "")
}

func atoi(digits string) int {
	value, _ := strconv.Atoi(digits)
	return value
}
