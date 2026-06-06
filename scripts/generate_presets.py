import yfinance as yf
import pandas as pd
import json
import os

def main():
    print("Fetching historical data from Yahoo Finance...")
    
    # Define tickers and names
    tickers = {
        "SPY": "SPY",      # S&P 500 ETF
        "GLD": "GLD",      # Gold ETF
        "BTC": "BTC-USD"   # Bitcoin USD
    }
    
    preset_data = {}
    
    # We download daily data for the last 3 years (approx 850 trading days for stocks, 1100 for crypto)
    start_date = "2023-01-01"
    end_date = "2026-06-01"
    
    for key, ticker in tickers.items():
        print(f"Downloading {key} ({ticker})...")
        try:
            df = yf.download(ticker, start=start_date, end=end_date)
            if df.empty:
                print(f"Warning: No data returned for {ticker}")
                continue
                
            # Clean dataframe
            df = df.reset_index()
            # yfinance might return multi-level columns, flatten them if needed
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = [col[0] for col in df.columns]
                
            # Keep only Date and Close columns
            df['Date'] = df['Date'].dt.strftime('%Y-%m-%d')
            # Select Close
            if 'Close' in df.columns:
                df = df[['Date', 'Close']]
            elif 'Adj Close' in df.columns:
                df = df[['Date', 'Adj Close']].rename(columns={'Adj Close': 'Close'})
            else:
                print(f"Warning: Could not find Close price for {ticker}")
                continue
                
            # Drop NaN and convert to records
            df = df.dropna()
            
            # Make sure Close is float
            df['Close'] = df['Close'].astype(float).round(2)
            
            records = df.to_dict(orient='records')
            preset_data[key] = records
            print(f"Loaded {len(records)} daily records for {key}.")
        except Exception as e:
            print(f"Error fetching data for {ticker}: {e}")
            
    # Write to js/presetData.js
    os.makedirs("js", exist_ok=True)
    output_path = os.path.join("js", "presetData.js")
    
    # We wrap it as a JS constant
    with open(output_path, "w", encoding="utf-8") as f:
        f.write("// Preset historical market data for the Regime Analysis Dashboard\n")
        f.write("const PRESET_DATA = ")
        json.dump(preset_data, f, indent=2)
        f.write(";\n")
        
    print(f"Successfully generated preset data at {output_path}!")

if __name__ == "__main__":
    main()
