package mediascrape

import (
	"encoding/xml"
	"fmt"
	"io"
	"regexp"
	"strconv"
	"strings"
)

// Kodi/Jellyfin .nfo files: rendering the ones a scrape writes, reading the
// TMDB id out of one a download already has, and reading back the fields of a
// movie .nfo for file metadata. The id reader scans the tags rather than
// parsing XML, so a malformed file still yields its id (the same rules as
// server/domain/media-nfo.ts).

// MaxNFOBytes is how much of an .nfo is read for its TMDB id.
const MaxNFOBytes = 64 * 1024

const xmlDeclaration = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`

// NFOKind is the root element of an .nfo, or "" when it is none of the known kinds.
type NFOKind string

const (
	NFOMovie   NFOKind = "movie"
	NFOTVShow  NFOKind = "tvshow"
	NFOEpisode NFOKind = "episodedetails"
)

// NFOIdentity is what an .nfo says it describes. TMDBID is 0 when it has none.
type NFOIdentity struct {
	Kind   NFOKind
	TMDBID int
}

// Movie is what ZPan reads from TMDB for a movie. Date is the release date,
// `YYYY-MM-DD`, or "". Runtime is in minutes, 0 when unknown.
type Movie struct {
	ID            int
	Title         string
	OriginalTitle string
	Overview      string
	Date          string
	Genres        []string
	Runtime       int
	Posters       []Image
	Backdrops     []Image
	PosterPath    string
	BackdropPath  string
}

// Year is the year of the release date, 0 when TMDB has none.
func (m Movie) Year() int {
	return yearOf(m.Date)
}

func yearOf(date string) int {
	if len(date) < 4 {
		return 0
	}
	year, err := strconv.Atoi(date[:4])
	if err != nil || year <= 0 {
		return 0
	}
	return year
}

type nfoField struct {
	name       string
	value      string
	attributes string
}

// MovieNFO renders a Kodi movie document.
func MovieNFO(movie Movie) string {
	fields := []nfoField{
		{name: "title", value: movie.Title},
		{name: "originaltitle", value: movie.OriginalTitle},
		{name: "year", value: positive(movie.Year())},
		{name: "plot", value: movie.Overview},
		{name: "premiered", value: movie.Date},
	}
	for _, genre := range movie.Genres {
		fields = append(fields, nfoField{name: "genre", value: genre})
	}
	fields = append(fields,
		nfoField{name: "runtime", value: positive(movie.Runtime)},
		nfoField{name: "uniqueid", value: positive(movie.ID), attributes: ` type="tmdb" default="true"`},
	)
	return nfoDocument(NFOMovie, fields)
}

func positive(value int) string {
	if value <= 0 {
		return ""
	}
	return strconv.Itoa(value)
}

func nfoDocument(root NFOKind, fields []nfoField) string {
	var b strings.Builder
	b.WriteString(xmlDeclaration)
	fmt.Fprintf(&b, "\n<%s>\n", root)
	for _, field := range fields {
		if field.value == "" {
			continue
		}
		fmt.Fprintf(&b, "  <%s%s>%s</%s>\n", field.name, field.attributes, escapeXML(field.value), field.name)
	}
	fmt.Fprintf(&b, "</%s>\n", root)
	return b.String()
}

var xmlEscaper = strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&apos;")

// escapeXML drops the characters XML 1.0 cannot carry, even escaped, then escapes markup.
func escapeXML(value string) string {
	value = strings.Map(func(r rune) rune {
		if (r < 0x20 && r != '\t' && r != '\n' && r != '\r') || r == 0xFFFE || r == 0xFFFF {
			return -1
		}
		return r
	}, value)
	return xmlEscaper.Replace(value)
}

// Markup that is not an element, and the text that ends it.
var markupEnds = [][2]string{{"<?", "?>"}, {"<!--", "-->"}, {"<!", ">"}}

var (
	tagName       = regexp.MustCompile(`^<([A-Za-z][\w.-]{0,63})[\s/>]`)
	tmdbType      = regexp.MustCompile(`(?i)\btype\s*=\s*["']tmdb["']`)
	elementNumber = regexp.MustCompile(`^\s*(\d{1,10})\s*$`)
)

// ReadNFOIdentity reads the root element and the TMDB id of an .nfo in one
// left-to-right pass over the tags, so the cost stays linear in the text
// whatever it holds: every lookup starts where the previous one ended, and an
// unclosed comment, declaration, or tag ends the pass.
func ReadNFOIdentity(text string) NFOIdentity {
	var root string
	uniqueID, tmdbID := 0, 0
	position := 0
	for uniqueID == 0 {
		open := strings.Index(text[position:], "<")
		if open == -1 {
			break
		}
		open += position
		end := ">"
		for _, markup := range markupEnds {
			if strings.HasPrefix(text[open:], markup[0]) {
				end = markup[1]
				break
			}
		}
		closeAt := strings.Index(text[open+1:], end)
		if closeAt == -1 {
			break
		}
		closeAt += open + 1
		position = closeAt + 1
		m := tagName.FindStringSubmatchIndex(text[open:])
		if m == nil {
			continue
		}
		name := strings.ToLower(text[open+m[2] : open+m[3]])
		if root == "" {
			root = name
		}
		attributesStart := open + m[3]
		if name == "uniqueid" && attributesStart <= closeAt && tmdbType.MatchString(text[attributesStart:closeAt]) {
			uniqueID = readElementNumber(text, position, name)
		} else if name == "tmdbid" && tmdbID == 0 {
			tmdbID = readElementNumber(text, position, name)
		}
	}
	identity := NFOIdentity{TMDBID: tmdbID}
	if uniqueID != 0 {
		identity.TMDBID = uniqueID
	}
	switch NFOKind(root) {
	case NFOMovie, NFOTVShow, NFOEpisode:
		identity.Kind = NFOKind(root)
	}
	return identity
}

// readElementNumber reads the number an element holds, up to the next tag,
// which must close it. It returns 0 for anything else.
func readElementNumber(text string, start int, name string) int {
	end := strings.Index(text[start:], "<")
	if end == -1 {
		return 0
	}
	end += start
	closing := "</" + name + ">"
	if end+len(closing) > len(text) || strings.ToLower(text[end:end+len(closing)]) != closing {
		return 0
	}
	m := elementNumber.FindStringSubmatch(text[start:end])
	if m == nil {
		return 0
	}
	value, _ := strconv.Atoi(m[1])
	return value
}

// MovieDetails is what a movie .nfo says, read back for file metadata.
type MovieDetails struct {
	TMDBID        int
	Title         string
	OriginalTitle string
	Year          int
	Overview      string
	Genres        []string
	Runtime       int
}

type movieNFODocument struct {
	XMLName       xml.Name      `xml:"movie"`
	Title         string        `xml:"title"`
	OriginalTitle string        `xml:"originaltitle"`
	Year          string        `xml:"year"`
	Plot          string        `xml:"plot"`
	Genres        []string      `xml:"genre"`
	Runtime       string        `xml:"runtime"`
	UniqueIDs     []nfoUniqueID `xml:"uniqueid"`
	TMDBID        string        `xml:"tmdbid"`
}

// ReadMovieNFO parses a movie .nfo. It fails unless the document is a
// `<movie>` with a title and a TMDB id.
func ReadMovieNFO(r io.Reader) (MovieDetails, error) {
	var doc movieNFODocument
	if err := xml.NewDecoder(io.LimitReader(r, MaxNFOBytes)).Decode(&doc); err != nil {
		return MovieDetails{}, fmt.Errorf("read movie nfo: %w", err)
	}
	details := MovieDetails{
		Title:         strings.TrimSpace(doc.Title),
		OriginalTitle: strings.TrimSpace(doc.OriginalTitle),
		Year:          atoi(strings.TrimSpace(doc.Year)),
		Overview:      strings.TrimSpace(doc.Plot),
		Runtime:       atoi(strings.TrimSpace(doc.Runtime)),
		TMDBID:        tmdbIDOf(doc.UniqueIDs, doc.TMDBID),
		Genres:        cleanGenres(doc.Genres),
	}
	if details.Title == "" || details.TMDBID <= 0 {
		return MovieDetails{}, fmt.Errorf("read movie nfo: missing title or TMDB id")
	}
	return details, nil
}

// Show is what ZPan reads from TMDB for a TV show. Date is the first air
// date, `YYYY-MM-DD`, or "".
type Show struct {
	ID            int
	Title         string
	OriginalTitle string
	Overview      string
	Date          string
	Genres        []string
	Posters       []Image
	Backdrops     []Image
	PosterPath    string
	BackdropPath  string
}

// Year is the year of the first air date, 0 when TMDB has none.
func (s Show) Year() int {
	return yearOf(s.Date)
}

// Season is one season of a show with the episodes TMDB lists for it.
type Season struct {
	Number     int
	PosterPath string
	Posters    []Image
	Episodes   []Episode
}

// Episode is one TMDB episode. ID is the episode's own id, not the series'.
// Aired is `YYYY-MM-DD` or "".
type Episode struct {
	ID        int
	Season    int
	Number    int
	Title     string
	Overview  string
	Aired     string
	StillPath string
}

// TVShowNFO renders a Kodi tvshow document.
func TVShowNFO(show Show) string {
	fields := []nfoField{
		{name: "title", value: show.Title},
		{name: "originaltitle", value: show.OriginalTitle},
		{name: "year", value: positive(show.Year())},
		{name: "plot", value: show.Overview},
		{name: "premiered", value: show.Date},
	}
	for _, genre := range show.Genres {
		fields = append(fields, nfoField{name: "genre", value: genre})
	}
	fields = append(fields, nfoField{name: "uniqueid", value: positive(show.ID), attributes: ` type="tmdb" default="true"`})
	return nfoDocument(NFOTVShow, fields)
}

// EpisodeNFO renders a Kodi episodedetails document. Season 0 is written, as
// specials are season 0.
func EpisodeNFO(episode Episode) string {
	return nfoDocument(NFOEpisode, []nfoField{
		{name: "title", value: episode.Title},
		{name: "season", value: strconv.Itoa(episode.Season)},
		{name: "episode", value: strconv.Itoa(episode.Number)},
		{name: "plot", value: episode.Overview},
		{name: "aired", value: episode.Aired},
		{name: "uniqueid", value: positive(episode.ID), attributes: ` type="tmdb"`},
	})
}

// ShowDetails is what a tvshow .nfo says, read back for file metadata.
type ShowDetails struct {
	TMDBID        int
	Title         string
	OriginalTitle string
	Year          int
	Overview      string
	Genres        []string
}

type nfoUniqueID struct {
	Type  string `xml:"type,attr"`
	Value string `xml:",chardata"`
}

func tmdbIDOf(ids []nfoUniqueID, fallback string) int {
	for _, id := range ids {
		if strings.EqualFold(id.Type, "tmdb") {
			return atoi(strings.TrimSpace(id.Value))
		}
	}
	return atoi(strings.TrimSpace(fallback))
}

func cleanGenres(genres []string) []string {
	var cleaned []string
	for _, genre := range genres {
		if genre = strings.TrimSpace(genre); genre != "" {
			cleaned = append(cleaned, genre)
		}
	}
	return cleaned
}

type tvShowNFODocument struct {
	XMLName       xml.Name      `xml:"tvshow"`
	Title         string        `xml:"title"`
	OriginalTitle string        `xml:"originaltitle"`
	Year          string        `xml:"year"`
	Plot          string        `xml:"plot"`
	Genres        []string      `xml:"genre"`
	UniqueIDs     []nfoUniqueID `xml:"uniqueid"`
	TMDBID        string        `xml:"tmdbid"`
}

// ReadTVShowNFO parses a tvshow .nfo. It fails unless the document is a
// `<tvshow>` with a title and a TMDB id.
func ReadTVShowNFO(r io.Reader) (ShowDetails, error) {
	var doc tvShowNFODocument
	if err := xml.NewDecoder(io.LimitReader(r, MaxNFOBytes)).Decode(&doc); err != nil {
		return ShowDetails{}, fmt.Errorf("read tvshow nfo: %w", err)
	}
	details := ShowDetails{
		TMDBID:        tmdbIDOf(doc.UniqueIDs, doc.TMDBID),
		Title:         strings.TrimSpace(doc.Title),
		OriginalTitle: strings.TrimSpace(doc.OriginalTitle),
		Year:          atoi(strings.TrimSpace(doc.Year)),
		Overview:      strings.TrimSpace(doc.Plot),
		Genres:        cleanGenres(doc.Genres),
	}
	if details.Title == "" || details.TMDBID <= 0 {
		return ShowDetails{}, fmt.Errorf("read tvshow nfo: missing title or TMDB id")
	}
	return details, nil
}

// EpisodeDetails is what an episodedetails .nfo says, read back for file
// metadata. TMDBID is the episode's own id.
type EpisodeDetails struct {
	TMDBID   int
	Title    string
	Season   int
	Episode  int
	Overview string
	Aired    string
}

type episodeNFODocument struct {
	XMLName   xml.Name      `xml:"episodedetails"`
	Title     string        `xml:"title"`
	Season    string        `xml:"season"`
	Episode   string        `xml:"episode"`
	Plot      string        `xml:"plot"`
	Aired     string        `xml:"aired"`
	UniqueIDs []nfoUniqueID `xml:"uniqueid"`
}

var nfoDate = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

// ReadEpisodeNFO parses an episodedetails .nfo. It fails unless the document
// is an `<episodedetails>` with a season and an episode number.
func ReadEpisodeNFO(r io.Reader) (EpisodeDetails, error) {
	var doc episodeNFODocument
	if err := xml.NewDecoder(io.LimitReader(r, MaxNFOBytes)).Decode(&doc); err != nil {
		return EpisodeDetails{}, fmt.Errorf("read episode nfo: %w", err)
	}
	season, seasonErr := strconv.Atoi(strings.TrimSpace(doc.Season))
	episode, episodeErr := strconv.Atoi(strings.TrimSpace(doc.Episode))
	if seasonErr != nil || episodeErr != nil || season < 0 || episode < 0 {
		return EpisodeDetails{}, fmt.Errorf("read episode nfo: missing season or episode number")
	}
	details := EpisodeDetails{
		TMDBID:   tmdbIDOf(doc.UniqueIDs, ""),
		Title:    strings.TrimSpace(doc.Title),
		Season:   season,
		Episode:  episode,
		Overview: strings.TrimSpace(doc.Plot),
	}
	if aired := strings.TrimSpace(doc.Aired); nfoDate.MatchString(aired) {
		details.Aired = aired
	}
	return details, nil
}
