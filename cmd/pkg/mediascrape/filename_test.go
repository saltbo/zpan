package mediascrape

import "testing"

// The cases of server/domain/media-filename.test.ts, so both parsers agree.
func TestParseFilename(t *testing.T) {
	cases := []struct {
		name string
		want Info
	}{
		{"Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.Atmos.mkv", Info{Kind: KindMovie, Title: "Dune Part Two", Year: 2024}},
		{"Inception (2010).mkv", Info{Kind: KindMovie, Title: "Inception", Year: 2010}},
		{"The_Matrix_[1999]_1080p.mp4", Info{Kind: KindMovie, Title: "The Matrix", Year: 1999}},
		{"1917.2019.1080p.BluRay.mkv", Info{Kind: KindMovie, Title: "1917", Year: 2019}},
		{"Blade.Runner.2049.2017.mkv", Info{Kind: KindMovie, Title: "Blade Runner 2049", Year: 2017}},
		{"Spider-Man.No.Way.Home.2021.mkv", Info{Kind: KindMovie, Title: "Spider-Man No Way Home", Year: 2021}},
		{"流浪地球2.2023.4K.mkv", Info{Kind: KindMovie, Title: "流浪地球2", Year: 2023}},
		{"Breaking.Bad.S03E09.720p.mkv", Info{Kind: KindEpisode, Title: "Breaking Bad", Season: 3, Episode: 9}},
		{"the.office.s01e02.mkv", Info{Kind: KindEpisode, Title: "the office", Season: 1, Episode: 2}},
		{"Show.Name.S01.E10.mkv", Info{Kind: KindEpisode, Title: "Show Name", Season: 1, Episode: 10}},
		{"Doctor.Who.2005.S02E01.mkv", Info{Kind: KindEpisode, Title: "Doctor Who", Season: 2, Episode: 1, Year: 2005}},
		{"Friends - 1x02 - The One with the Sonogram.avi", Info{Kind: KindEpisode, Title: "Friends", Season: 1, Episode: 2}},
		{"权力的游戏.S03E09.mkv", Info{Kind: KindEpisode, Title: "权力的游戏", Season: 3, Episode: 9}},
		{"庆余年 第2季第3集.mp4", Info{Kind: KindEpisode, Title: "庆余年", Season: 2, Episode: 3}},
		{"S01E02.mkv", Info{Kind: KindEpisode, Title: "", Season: 1, Episode: 2}},
		{"Show.S01E01E02.mkv", Info{Kind: KindEpisode, Title: "Show", Season: 1, Episode: 1}},
		{"VID_20240101_123456.mp4", Info{Kind: KindUnknown, Title: "VID_20240101_123456"}},
		{"holiday-clip.mov", Info{Kind: KindUnknown, Title: "holiday-clip"}},
		{"2012.mkv", Info{Kind: KindUnknown, Title: "2012"}},
		{"Movie.1920x1080.mkv", Info{Kind: KindUnknown, Title: "Movie.1920x1080"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := ParseFilename(tc.name); got != tc.want {
				t.Fatalf("ParseFilename(%q) = %+v, want %+v", tc.name, got, tc.want)
			}
		})
	}
}

func TestParsePath(t *testing.T) {
	got := ParsePath([]string{"TV", "The Wire (2002)", "Season 01"}, "S01E05.mkv")
	if want := (Info{Kind: KindEpisode, Title: "The Wire", Season: 1, Episode: 5, Year: 2002}); got != want {
		t.Fatalf("bare episode = %+v, want %+v", got, want)
	}
	if got := ParsePath([]string{"剧集", "庆余年", "第一季"}, "S01E01.mp4"); got.Title != "庆余年" {
		t.Fatalf("CJK show title = %q", got.Title)
	}
	if got := ParsePath([]string{"TV", "Other"}, "Breaking.Bad.S01E01.mkv"); got.Title != "Breaking Bad" {
		t.Fatalf("filename title = %q", got.Title)
	}
	if got := ParsePath([]string{"Season 2"}, "S02E03.mkv"); got.Title != "" || got.Season != 2 || got.Episode != 3 {
		t.Fatalf("all season folders = %+v", got)
	}
}

func TestIsSeasonFolder(t *testing.T) {
	cases := map[string]bool{
		"Season 1": true, "season01": true, "S01": true, "Series 2": true, "第1季": true, "第一季": true,
		"Specials": true, "Breaking Bad": false, "Season 1 Extras": false,
	}
	for name, want := range cases {
		if got := IsSeasonFolder(name); got != want {
			t.Errorf("IsSeasonFolder(%q) = %v, want %v", name, got, want)
		}
	}
}
