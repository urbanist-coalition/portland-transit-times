
async function main() {
  const res = await fetch("https://swiv.gptd.cadavl.com/SWIV/GPTD/proxy/restWS/horaires/pta/138085?_tmp=1733802694814", {
    "credentials": "omit",
    "headers": {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0",
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "Accept-Language": "en-US,en;q=0.5",
      "X-Requested-With": "XMLHttpRequest",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "Sec-GPC": "1"
    },
    "referrer": "https://swiv.gptd.cadavl.com/SWIV/GPTD",
    "method": "GET",
    "mode": "cors"
  });
  const data = await res.json();
  console.log(data);
}

main();
