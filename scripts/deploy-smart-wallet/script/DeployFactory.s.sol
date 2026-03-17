// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Script, console} from "forge-std/Script.sol";
import {CoinbaseSmartWalletFactory} from "smart-wallet/src/CoinbaseSmartWalletFactory.sol";
import {CoinbaseSmartWallet} from "smart-wallet/src/CoinbaseSmartWallet.sol";

contract DeployFactory is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(deployerKey);

        CoinbaseSmartWallet implementation = new CoinbaseSmartWallet();
        console.log("Implementation:", address(implementation));

        CoinbaseSmartWalletFactory factory = new CoinbaseSmartWalletFactory(address(implementation));
        console.log("Factory:", address(factory));

        vm.stopBroadcast();
    }
}
