package mediascrape

import (
	"strings"
	"testing"
	"time"
)

var sampleMovie = Movie{
	ID:            27205,
	Title:         `Tom & Jerry's "<Best>"`,
	OriginalTitle: "盗梦空间",
	Overview:      "A thief\u0007 who steals secrets.",
	Date:          "2010-07-15",
	Genres:        []string{"Action", "科幻"},
	Runtime:       148,
}

func TestMovieNFO(t *testing.T) {
	want := strings.Join([]string{
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`,
		`<movie>`,
		`  <title>Tom &amp; Jerry&apos;s &quot;&lt;Best&gt;&quot;</title>`,
		`  <originaltitle>盗梦空间</originaltitle>`,
		`  <year>2010</year>`,
		`  <plot>A thief who steals secrets.</plot>`,
		`  <premiered>2010-07-15</premiered>`,
		`  <genre>Action</genre>`,
		`  <genre>科幻</genre>`,
		`  <runtime>148</runtime>`,
		`  <uniqueid type="tmdb" default="true">27205</uniqueid>`,
		`</movie>`,
		``,
	}, "\n")
	if got := MovieNFO(sampleMovie); got != want {
		t.Fatalf("MovieNFO =\n%s\nwant\n%s", got, want)
	}
	sparse := MovieNFO(Movie{ID: 27205, Title: "Inception"})
	for _, tag := range []string{"<plot>", "<year>", "<premiered>", "<runtime>", "<genre>"} {
		if strings.Contains(sparse, tag) {
			t.Errorf("sparse movie renders %s", tag)
		}
	}
}

func TestReadMovieNFORoundTrip(t *testing.T) {
	got, err := ReadMovieNFO(strings.NewReader(MovieNFO(sampleMovie)))
	if err != nil {
		t.Fatal(err)
	}
	if got.TMDBID != 27205 || got.Title != sampleMovie.Title || got.OriginalTitle != "盗梦空间" || got.Year != 2010 ||
		got.Overview != "A thief who steals secrets." || got.Runtime != 148 || len(got.Genres) != 2 {
		t.Fatalf("ReadMovieNFO = %+v", got)
	}
	if _, err := ReadMovieNFO(strings.NewReader("<tvshow><title>x</title></tvshow>")); err == nil {
		t.Fatal("a tvshow document reads as a movie")
	}
	if _, err := ReadMovieNFO(strings.NewReader("<movie><title>x</title></movie>")); err == nil {
		t.Fatal("a movie without a TMDB id reads")
	}
}

// The cases of server/domain/media-nfo.test.ts. [spec: download-scraping/match-rules]
func TestReadNFOIdentity(t *testing.T) {
	cases := []struct {
		label string
		text  string
		want  NFOIdentity
	}{
		{"our own movie file", MovieNFO(sampleMovie), NFOIdentity{Kind: NFOMovie, TMDBID: 27205}},
		{"attributes in another order", "\ufeff<?xml version='1.0'?>\n<!-- edited -->\n<tvshow><uniqueid default='true' type='tmdb'> 1399 </uniqueid></tvshow>", NFOIdentity{Kind: NFOTVShow, TMDBID: 1399}},
		{"a tmdbid element", `<movie><uniqueid type="imdb">tt1375666</uniqueid><tmdbid>27205</tmdbid></movie>`, NFOIdentity{Kind: NFOMovie, TMDBID: 27205}},
		{"an episode file", `<episodedetails><uniqueid type="tmdb">63056</uniqueid></episodedetails>`, NFOIdentity{Kind: NFOEpisode, TMDBID: 63056}},
		{"no TMDB id", `<movie><uniqueid type="imdb">tt1375666</uniqueid></movie>`, NFOIdentity{Kind: NFOMovie}},
		{"text that is not an nfo", "https://www.themoviedb.org/movie/27205", NFOIdentity{}},
		{"malformed XML", `<movie><title>Unclosed<uniqueid type="tmdb">27205</uniqueid>`, NFOIdentity{Kind: NFOMovie, TMDBID: 27205}},
		{"a commented-out id", `<movie><!-- <uniqueid type="tmdb">1</uniqueid> --><uniqueid type="tmdb">27205</uniqueid></movie>`, NFOIdentity{Kind: NFOMovie, TMDBID: 27205}},
	}
	for _, tc := range cases {
		t.Run(tc.label, func(t *testing.T) {
			if got := ReadNFOIdentity(tc.text); got != tc.want {
				t.Fatalf("ReadNFOIdentity = %+v, want %+v", got, tc.want)
			}
		})
	}
}

func TestReadNFOIdentityIsLinear(t *testing.T) {
	for _, unit := range []string{"<?", "<!--", "<!", "<a ", `<uniqueid type="tmdb">1`, "a"} {
		text := ("<" + strings.Repeat(unit, MaxNFOBytes/len(unit)+1))[:MaxNFOBytes]
		started := time.Now()
		ReadNFOIdentity(text)
		if elapsed := time.Since(started); elapsed > 50*time.Millisecond {
			t.Errorf("64 KB of %q took %s", unit, elapsed)
		}
	}
}
