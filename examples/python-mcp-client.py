#!/usr/bin/env python3

"""
Example: Python MCP Client for NetSuite Server

This demonstrates how to call the MCP NetSuite server from Python
using the official MCP SDK.

Installation:
    pip install mcp anthropic-mcp

Usage:
    python examples/python-mcp-client.py
"""

import asyncio
import json
import os
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

async def main():
    # Server parameters - pointing to our compiled JavaScript
    server_params = StdioServerParameters(
        command="node",
        args=["./dist/index.js"],
        env={
            # Load from environment or .env file
            "NETSUITE_SB1_ACCOUNT_ID": os.getenv("NETSUITE_SB1_ACCOUNT_ID"),
            "NETSUITE_SB1_CLIENT_ID": os.getenv("NETSUITE_SB1_CLIENT_ID"),
            "NETSUITE_SB1_CERTIFICATE_ID": os.getenv("NETSUITE_SB1_CERTIFICATE_ID"),
            "NETSUITE_SB1_PRIVATE_KEY": os.getenv("NETSUITE_SB1_PRIVATE_KEY"),
            "NETSUITE_DEFAULT_ENV": "sb1",
        }
    )

    # Connect to the MCP server
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            # Initialize the session
            await session.initialize()
            
            print("✓ Connected to MCP NetSuite server\n")

            # Example 1: List available tools
            tools = await session.list_tools()
            print(f"📦 Available tools: {len(tools.tools)}")
            for tool in tools.tools[:5]:
                print(f"  - {tool.name}")
            print()

            # Example 2: List environments
            print("🌍 Listing environments...")
            env_result = await session.call_tool("list_environments", {})
            env_data = json.loads(env_result.content[0].text)
            print(f"Default: {env_data['defaultEnvironment']}")
            for env in env_data['environments']:
                print(f"  - {env['id']}: {env['accountId']}")
            print()

            # Example 3: Run SuiteQL query
            print("📊 Running SuiteQL query...")
            query_result = await session.call_tool("run_suiteql", {
                "query": "SELECT id, companyname FROM customer WHERE isinactive = 'F' ORDER BY id",
                "limit": 5,
                "environment": "sb1"
            })
            
            query_data = json.loads(query_result.content[0].text)
            print(f"Found {query_data['totalResults']} customers, showing {query_data['count']}:")
            for item in query_data['items']:
                print(f"  - [{item['id']}] {item['companyname']}")
            print()

            # Example 4: Get custom record types
            print("🔧 Getting custom record types...")
            custom_result = await session.call_tool("get_custom_record_types", {
                "includeInactive": False,
                "environment": "sb1"
            })
            
            custom_data = json.loads(custom_result.content[0].text)
            print(f"Found {custom_data['totalTypes']} custom record types")
            if custom_data['totalTypes'] > 0:
                for record_type in custom_data['customRecordTypes'][:3]:
                    print(f"  - {record_type['scriptid']}: {record_type['name']}")
            print()

            # Example 5: Get script logs
            print("📝 Getting recent script logs...")
            logs_result = await session.call_tool("get_script_logs", {
                "limit": 5,
                "environment": "sb1"
            })
            
            logs_data = json.loads(logs_result.content[0].text)
            print(f"Found {logs_data['totalResults']} log entries")
            print()

            print("✓ All examples completed!")

if __name__ == "__main__":
    # Load environment variables from .env.sb1 if exists
    try:
        from dotenv import load_dotenv
        load_dotenv(".env.sb1")
        print("Loaded environment from .env.sb1\n")
    except ImportError:
        print("dotenv not installed - using system environment variables\n")
    
    asyncio.run(main())

