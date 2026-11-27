package mediascrape

import "testing"

// [spec: download-scraping/match-rules]

func TestNormalizeTitle(t *testing.T) {
	cases := map[string]string{
		"The Matrix":              "matrix",
		"Spider-Man: No Way Home": "spidermannowayhome",
		"Amélie":                  "amelie",
		"Fast & Furious":          "fastandfurious",
		"A Quiet Place":           "quietplace",
		"流浪地球2":                   "流浪地球2",
		"ＷＡＬＬ·Ｅ":                  "walle",
	}
	for title, want := range cases {
		if got := NormalizeTitle(title); got != want {
			t.Errorf("NormalizeTitle(%q) = %q, want %q", title, got, want)
		}
	}
}

func TestTitleSimilarity(t *testing.T) {
	if got := TitleSimilarity("the.matrix", "The Matrix"); got != 1 {
		t.Errorf("equal titles = %v", got)
	}
	if got := TitleSimilarity("Inception", "Interstellar"); got >= 0.5 {
		t.Errorf("unrelated titles = %v", got)
	}
	if got := TitleSimilarity("", "Inception"); got != 0 {
		t.Errorf("empty title = %v", got)
	}
	if got := TitleSimilarity("权力的游戏", "权力的游戏"); got != 1 {
		t.Errorf("CJK titles = %v", got)
	}
}

func hit(id int, title string, year int, original ...string) SearchHit {
	h := SearchHit{ID: id, Title: title, OriginalTitle: title, Year: year}
	if len(original) > 0 {
		h.OriginalTitle = original[0]
	}
	return h
}

func TestChooseMatch(t *testing.T) {
	cases := []struct {
		label string
		title string
		year  int
		hits  []SearchHit
		want  int
	}{
		{"an exact title and year", "Inception", 2010, []SearchHit{hit(1, "Inception", 2010)}, 1},
		{"the original title", "Inception", 2010, []SearchHit{hit(2, "盗梦空间", 2010, "Inception")}, 2},
		{"a year one off", "Inception", 2011, []SearchHit{hit(3, "Inception", 2010)}, 3},
		{"no result more than a year off", "Dune", 2021, []SearchHit{hit(4, "Dune", 1984)}, 0},
		{"the closest year", "Dune", 2021, []SearchHit{hit(5, "Dune", 2020), hit(6, "Dune", 2021)}, 6},
		{"TMDB's order", "Dune", 0, []SearchHit{hit(7, "Dune", 1984), hit(8, "Dune", 2021)}, 7},
		{"an unknown year", "Untitled Project", 2030, []SearchHit{hit(9, "Untitled Project", 0)}, 9},
		{"nothing for a dissimilar title", "Home Video", 0, []SearchHit{hit(10, "Home Alone", 1990)}, 0},
		{"nothing for no results", "Inception", 2010, nil, 0},
		{"the more similar title", "The Office US", 0, []SearchHit{hit(11, "The Office", 2001), hit(12, "The Office (US)", 2005)}, 12},
	}
	for _, tc := range cases {
		t.Run(tc.label, func(t *testing.T) {
			got, ok := ChooseMatch(tc.title, tc.year, tc.hits)
			id := 0
			if ok {
				id = got.ID
			}
			if id != tc.want {
				t.Fatalf("ChooseMatch = %d, want %d", id, tc.want)
			}
		})
	}
}

func TestChooseMatchSequelNumbers(t *testing.T) {
	cases := []struct {
		title, candidate string
		matches          bool
	}{
		{"Toy Story 2", "Toy Story 3", false},
		{"Toy Story 2", "Toy Story", false},
		{"Toy Story", "Toy Story 2", false},
		{"Rocky II", "Rocky III", false},
		{"唐人街探案2", "唐人街探案3", false},
		{"唐人街探案２", "唐人街探案3", false},
		{"Harry Potter and the Deathly Hallows Part 1", "Harry Potter and the Deathly Hallows: Part 2", false},
		{"Toy Story 3", "Toy Story 3", true},
		{"Rocky II", "Rocky II", true},
		{"唐人街探案2", "唐人街探案２", true},
		{"Blade Runner 2049", "Blade Runner 2049", true},
	}
	for _, tc := range cases {
		if _, ok := ChooseMatch(tc.title, 0, []SearchHit{hit(1, tc.candidate, 0)}); ok != tc.matches {
			t.Errorf("ChooseMatch(%q, %q) matched = %v, want %v", tc.title, tc.candidate, ok, tc.matches)
		}
	}
}

func ranked(h SearchHit, popularity float64, votes int) SearchHit {
	h.Popularity, h.VoteCount = popularity, votes
	return h
}

// Popularity and votes are TMDB's for these titles on 2026-11-27.
// [spec: download-scraping/yearless-match]
func TestChooseYearlessMatch(t *testing.T) {
	cases := []struct {
		label string
		title string
		hits  []SearchHit
		want  int
	}{
		{"the only well-known result", "Sintel", []SearchHit{ranked(hit(45745, "寻龙记", 2010, "Sintel"), 2.05, 183)}, 45745},
		{"a clear lead over a namesake", "Avatar", []SearchHit{
			ranked(hit(1544429, "Avatar", 1964), 0.40, 0),
			ranked(hit(19995, "Avatar", 2009), 31.77, 35097),
			ranked(hit(216527, "Avatar 4", 2029), 3.52, 0),
		}, 19995},
		{"dissimilar results do not compete", "Inception", []SearchHit{
			ranked(hit(27205, "Inception", 2010), 50.12, 40847),
			ranked(hit(64956, "Inception: The Cobol Job", 2010), 1.71, 322),
		}, 27205},
		{"nothing for a remake and its original", "Dune", []SearchHit{
			ranked(hit(438631, "Dune", 2021), 45.50, 16051),
			ranked(hit(841, "Dune", 1984), 12.88, 3639),
		}, 0},
		{"nothing for an obscure film", "Birthday", []SearchHit{ranked(hit(574297, "Birthday", 2019), 1.29, 27)}, 0},
		{"nothing when the most popular title is not exact", "Inception", []SearchHit{
			ranked(hit(1, "Inceptions", 2001), 40, 5000),
			ranked(hit(2, "Inception", 2005), 1, 200),
		}, 0},
		{"nothing for no results", "Sintel", nil, 0},
	}
	for _, tc := range cases {
		t.Run(tc.label, func(t *testing.T) {
			got, ok := ChooseYearlessMatch(tc.title, tc.hits)
			id := 0
			if ok {
				id = got.ID
			}
			if id != tc.want {
				t.Fatalf("ChooseYearlessMatch = %d, want %d", id, tc.want)
			}
		})
	}
}

func TestChooseImage(t *testing.T) {
	images := []Image{{Path: "/en.jpg", Language: "en"}, {Path: "/textless.jpg"}, {Path: "/zh.jpg", Language: "zh"}}
	if got := chooseImage(images, posterPreference("zh-CN")); got != "/zh.jpg" {
		t.Errorf("poster = %q", got)
	}
	if got := chooseImage(images, fanartPreference("zh-CN")); got != "/textless.jpg" {
		t.Errorf("fanart = %q", got)
	}
	if got := chooseImage(images[:1], posterPreference("ja-JP")); got != "/en.jpg" {
		t.Errorf("english fallback = %q", got)
	}
	if got := chooseImage([]Image{{Path: "/fr.jpg", Language: "fr"}}, posterPreference("ja-JP")); got != "" {
		t.Errorf("no preferred image = %q", got)
	}
}
