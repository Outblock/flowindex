// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Script, console} from "forge-std/Script.sol";
import {VerifyingPaymaster} from "../src/VerifyingPaymaster.sol";

contract DeployPaymaster is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address verifyingSigner = vm.envAddress("PAYMASTER_SIGNER");
        address entryPoint = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;

        vm.startBroadcast(deployerKey);

        // Deploy paymaster
        VerifyingPaymaster paymaster = new VerifyingPaymaster(
            entryPoint,
            verifyingSigner
        );
        console.log("Paymaster:", address(paymaster));

        // Deposit 10 FLOW to EntryPoint for gas sponsoring
        paymaster.deposit{value: 10 ether}();
        console.log("Deposited 10 FLOW to EntryPoint");

        // Stake 1 FLOW (required for paymaster, 1 day unstake delay)
        paymaster.addStake{value: 1 ether}(86400);
        console.log("Staked 1 FLOW with 1 day unstake delay");

        vm.stopBroadcast();
    }
}
