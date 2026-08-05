name=scraper.js
const axios = require('axios');
const cheerio = require('cheerio');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://pitvmvbtourmonkwzwoq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBpdHZtdmJ0b3VybW9ua3d6d29xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxMzI1MzAsImV4cCI6MjA5OTcwODUzMH0.JuZgmU-qTD5An29i3dRDSEUtyDjOTazj6Klekpbg508';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function scrapeAndSync() {
  console.log("🔍 Gestart met het ophalen van wedstrijden, datums en uren...");

  try {
    const response = await axios.get('https://www.voetbalkrant.com/belgie/jupiler-pro-league/kalender', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const $ = cheerio.load(response.data);
    const matchesToUpsert = [];

    const { data: dbTeams, error: teamError } = await supabase.from('teams').select('id, name');
    if (teamError) throw teamError;

    const findTeamId = (teamName) => {
      const match = dbTeams.find(t => 
        t.name.toLowerCase().includes(teamName.toLowerCase()) || 
        teamName.toLowerCase().includes(t.name.toLowerCase())
      );
      return match ? match.id : null;
    };

    let huidigeSpeeldag = 1;
    
    // PUNT 1: Bepaal het huidige seizoen-startjaar dynamisch
    // Als we nu in jan-juni zitten, is het seizoen vorig jaar gestart. Anders dit jaar.
    const nu = new Date();
    const huidigMaand = nu.getMonth() + 1; // 1 - 12
    const seizoenStartJaar = huidigMaand < 7 ? nu.getFullYear() - 1 : nu.getFullYear();

    $('.table-responsive tr, table.table tr').each((i, el) => {
      const fullRowText = $(el).text().trim();

      // Speeldag-titel opvangen (bijv. "Speeldag 2")
      if (fullRowText.toLowerCase().includes('speeldag') || fullRowText.toLowerCase().includes('supercup')) {
        const speeldagMatch = fullRowText.match(/Speeldag\s+(\d+)/i);
        if (speeldagMatch) {
          huidigeSpeeldag = parseInt(speeldagMatch[1], 10);
        }
        return;
      }

      const cells = $(el).find('td');
      if (cells.length >= 4) {
        const dateTimeText = $(cells[0]).text().trim(); // bijv. "15/08 16:00" of "15/01 20:00"
        const homeTeamText = $(cells[1]).text().trim();
        const scoreText    = $(cells[2]).text().trim();
        const awayTeamText = $(cells[3]).text().trim();

        if (homeTeamText && awayTeamText) {
          const homeTeamId = findTeamId(homeTeamText);
          const awayTeamId = findTeamId(awayTeamText);

          if (homeTeamId && awayTeamId) {
            let isoMatchDate = null;

            // Datum & Tijd samenvoegen tot Timestamptz
            if (dateTimeText) {
              const parts = dateTimeText.split(/\s+/);
              if (parts.length >= 1 && parts[0].includes('/')) {
                const [dag, maand] = parts[0].split('/'); // "15", "08"
                const maandInt = parseInt(maand, 10);

                // PUNT 1: Als maand 1 t/m 6 is, valt de wedstrijd in het tweede jaar van het seizoen
                const matchJaar = maandInt < 7 ? seizoenStartJaar + 1 : seizoenStartJaar;

                let uur = "00";
                let minuut = "00";

                if (parts.length >= 2) {
                  const schoonUur = parts[1].replace('?', '').trim(); // verwijder '?'
                  if (schoonUur.includes(':')) {
                    [uur, minuut] = schoonUur.split(':');
                  }
                }

                const formattedMonth = maand.padStart(2, '0');
                const formattedDay = dag.padStart(2, '0');
                const formattedHour = uur.padStart(2, '0');
                const formattedMinute = minuut.padStart(2, '0');

                isoMatchDate = `${matchJaar}-${formattedMonth}-${formattedDay}T${formattedHour}:${formattedMinute}:00`;
              }
            }

            // Scores verwerken
            let homeScore = null;
            let awayScore = null;

            if (scoreText && scoreText.includes('-') && !scoreText.includes('...')) {
              const scoreParts = scoreText.split('-');
              if (scoreParts.length === 2) {
                const h = parseInt(scoreParts[0].trim());
                const a = parseInt(scoreParts[1].trim());
                if (!isNaN(h) && !isNaN(a)) {
                  homeScore = h;
                  awayScore = a;
                }
              }
            }

            matchesToUpsert.push({
              home_team_id: homeTeamId,
              away_team_id: awayTeamId,
              home_score: homeScore,
              away_score: awayScore,
              match_date: isoMatchDate,
              round: huidigeSpeeldag
            });
          }
        }
      }
    });

    console.log(`📦 ${matchesToUpsert.length} wedstrijden verwerkt! Opslaan in Supabase...`);

    for (const match of matchesToUpsert) {
      const { data: existingMatch } = await supabase
        .from('matches')
        .select('id')
        .eq('home_team_id', match.home_team_id)
        .eq('away_team_id', match.away_team_id)
        .maybeSingle();

      if (existingMatch) {
        await supabase
          .from('matches')
          .update({
            home_score: match.home_score,
            away_score: match.away_score,
            match_date: match.match_date,
            round: match.round
          })
          .eq('id', existingMatch.id);
      } else {
        await supabase.from('matches').insert(match);
      }
    }

    console.log("✅ Datums en Uren succesvol als timestamptz geüpdatet in Supabase!");

  } catch (err) {
    console.error("❌ Fout tijdens het scrapen:", err.message);
  }
}

scrapeAndSync();
